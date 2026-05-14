import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  TextInput as RNTextInput,
  Linking,
} from 'react-native';
import HorizontalScroll from '@/components/common/HorizontalScroll';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Stack, useRouter } from 'expo-router';
import { generateAndUploadReport } from './reports/generate';

type ReportType =
  | 'general'
  | 'worker_comparison'
  | 'team_comparison'
  | 'workflow_analysis'
  | 'user_performance_series'
  | 'user_performance_summary'
  | 'pipeline_stage_dwell'
  | 'pipeline_throughput'
  | 'personnel_comparison'
  | 'targets_status'
  | 'personal_pulse';

type TemporalMode = 'range' | 'series' | 'none';

function getTemporalMode(type: ReportType): TemporalMode {
  if (type === 'user_performance_series' || type === 'pipeline_throughput') return 'series';
  if (type === 'targets_status' || type === 'personal_pulse') return 'none';
  return 'range';
}

const REPORT_TYPES: {
  value: ReportType;
  label: string;
  desc: string;
  icon: string;
  group: 'legacy' | 'analytics';
}[] = [
  { value: 'general',                  label: 'Tactical Performance Audit',   desc: 'Holistic organization or pipeline metrics',               icon: 'bar-chart',     group: 'legacy'    },
  { value: 'worker_comparison',         label: 'Personnel Benchmarking',        desc: 'Delta analysis between two deployment assets',            icon: 'users',         group: 'legacy'    },
  { value: 'team_comparison',           label: 'Structural Matrix Analysis',    desc: 'Efficiency metrics across structural units',              icon: 'group',         group: 'legacy'    },
  { value: 'workflow_analysis',         label: 'Pipeline Bottleneck Scan',      desc: 'Stage-by-stage efficiency & delay deep-dive',            icon: 'rocket',        group: 'legacy'    },
  { value: 'user_performance_series',   label: 'Worker Performance Timeline',   desc: 'Period-by-period output, session hours & efficiency',     icon: 'line-chart',    group: 'analytics' },
  { value: 'user_performance_summary',  label: 'Worker Performance Summary',    desc: 'All aggregated stats for one worker over a date range',   icon: 'user',          group: 'analytics' },
  { value: 'pipeline_stage_dwell',      label: 'Stage Dwell Analysis',          desc: 'Avg/median/P75 dwell, bottleneck flag, reversal counts',  icon: 'clock-o',       group: 'analytics' },
  { value: 'pipeline_throughput',       label: 'Pipeline Throughput Report',    desc: 'Period success/failure rates across a pipeline',          icon: 'area-chart',    group: 'analytics' },
  { value: 'personnel_comparison',      label: 'Multi-Personnel Comparison',    desc: 'Cost analysis, points/hour & efficiency across workers',  icon: 'balance-scale', group: 'analytics' },
  { value: 'targets_status',            label: 'Objectives & SLA Report',       desc: 'All active, hit, and expired performance targets',        icon: 'bullseye',      group: 'analytics' },
  { value: 'personal_pulse',            label: 'Personal Activity Snapshot',    desc: 'Your daily/monthly points, session time & flap rate',     icon: 'heartbeat',     group: 'analytics' },
];

export default function ReportGeneratorDesktop() {
  const router = useRouter();
  const { hasPermission, user, profile } = useAuth();

  const [reportType, setReportType]         = useState<ReportType>('general');
  const [timeFrame, setTimeFrame]           = useState<'7' | '30' | '90' | 'custom'>('30');
  const [dateStart, setDateStart]           = useState('');
  const [dateEnd, setDateEnd]               = useState('');
  const [pipelineId, setPipelineId]         = useState('');
  const [teamId, setTeamId]                 = useState('');
  const [workerId, setWorkerId]             = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [workerA_id, setWorkerA_id]         = useState('');
  const [workerB_id, setWorkerB_id]         = useState('');
  const [teamA_id, setTeamA_id]             = useState('');
  const [teamB_id, setTeamB_id]             = useState('');
  // Analytics-engine specific
  const [singleUserId, setSingleUserId]     = useState('');
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [salaries, setSalaries]             = useState<Record<string, number>>({});
  const [periodType, setPeriodType]         = useState<'week' | 'month' | 'year'>('month');
  const [nPeriods, setNPeriods]             = useState('12');

  const [pipelines, setPipelines] = useState<any[]>([]);
  const [teams, setTeams]         = useState<any[]>([]);
  const [workers, setWorkers]     = useState<any[]>([]);
  const [loading, setLoading]     = useState(false);

  useEffect(() => { loadFilterOptions(); }, []);

  const loadFilterOptions = async () => {
    const [pipeRes, teamRes, workerRes] = await Promise.all([
      supabase.from('pipelines').select('id, name').is('deleted_at', null).order('name'),
      supabase.from('teams').select('id, name').is('deleted_at', null).order('name'),
      supabase.from('users').select('id, full_name').is('deleted_at', null).order('full_name'),
    ]);
    setPipelines(pipeRes.data || []);
    setTeams(teamRes.data || []);
    setWorkers(workerRes.data || []);
  };

  const toggleMultiUser = (uid: string) => {
    setSelectedUserIds(prev =>
      prev.includes(uid) ? prev.filter(x => x !== uid) : [...prev, uid]
    );
  };

  const handleGenerateReport = async () => {
    try {
      setLoading(true);
      const temporalMode = getTemporalMode(reportType);

      // --- Temporal params ---
      let days = 30;
      let dateStartParam: string | null = null;
      let dateEndParam: string | null = null;

      if (temporalMode === 'range') {
        if (timeFrame === 'custom') {
          dateStartParam = dateStart ? new Date(dateStart).toISOString() : null;
          dateEndParam   = dateEnd   ? new Date(dateEnd).toISOString()   : null;
          if (!dateStartParam || !dateEndParam) {
            Alert.alert('Error', 'Please provide both start and end dates');
            return;
          }
        } else {
          days = parseInt(timeFrame);
          const now = new Date();
          dateEndParam   = now.toISOString();
          dateStartParam = new Date(now.getTime() - days * 86400000).toISOString();
        }
      }

      // --- Build parameters ---
      const parameters: Record<string, any> = {};

      switch (reportType) {
        case 'general':
        case 'workflow_analysis': {
          parameters.days = days;
          parameters.scope = reportType === 'general' ? (pipelineId ? 'pipeline' : 'organization') : reportType;
          if (pipelineId)     parameters.pipeline_id = pipelineId;
          if (teamId)         parameters.team_id     = teamId;
          if (workerId)       parameters.worker_id   = workerId;
          if (priorityFilter) parameters.priority    = priorityFilter;
          if (dateStartParam) parameters.date_start  = dateStartParam;
          if (dateEndParam)   parameters.date_end    = dateEndParam;
          break;
        }
        case 'worker_comparison': {
          if (!workerA_id || !workerB_id) {
            Alert.alert('Error', 'Please select both workers for comparison');
            return;
          }
          parameters.days         = days;
          parameters.worker_a_id  = workerA_id;
          parameters.worker_b_id  = workerB_id;
          if (dateStartParam) parameters.date_start = dateStartParam;
          if (dateEndParam)   parameters.date_end   = dateEndParam;
          break;
        }
        case 'team_comparison': {
          if (!teamA_id || !teamB_id) {
            Alert.alert('Error', 'Please select both teams for comparison');
            return;
          }
          parameters.days       = days;
          parameters.team_a_id  = teamA_id;
          parameters.team_b_id  = teamB_id;
          if (dateStartParam) parameters.date_start = dateStartParam;
          if (dateEndParam)   parameters.date_end   = dateEndParam;
          break;
        }
        case 'user_performance_series': {
          if (!singleUserId) {
            Alert.alert('Error', 'Please select a worker');
            return;
          }
          parameters.user_id     = singleUserId;
          parameters.period_type = periodType;
          parameters.n_periods   = parseInt(nPeriods) || 12;
          break;
        }
        case 'user_performance_summary': {
          if (!singleUserId) {
            Alert.alert('Error', 'Please select a worker');
            return;
          }
          parameters.user_id    = singleUserId;
          parameters.date_start = dateStartParam;
          parameters.date_end   = dateEndParam;
          break;
        }
        case 'pipeline_stage_dwell': {
          if (!pipelineId) {
            Alert.alert('Error', 'Please select a pipeline');
            return;
          }
          parameters.pipeline_id = pipelineId;
          parameters.date_start  = dateStartParam;
          parameters.date_end    = dateEndParam;
          break;
        }
        case 'pipeline_throughput': {
          if (!pipelineId) {
            Alert.alert('Error', 'Please select a pipeline');
            return;
          }
          parameters.pipeline_id = pipelineId;
          parameters.period_type = periodType;
          parameters.n_periods   = parseInt(nPeriods) || 12;
          break;
        }
        case 'personnel_comparison': {
          if (selectedUserIds.length < 2) {
            Alert.alert('Error', 'Please select at least 2 workers');
            return;
          }
          parameters.user_ids   = selectedUserIds;
          parameters.date_start = dateStartParam;
          parameters.date_end   = dateEndParam;
          if (Object.keys(salaries).length > 0) parameters.salaries = salaries;
          break;
        }
        case 'targets_status':
        case 'personal_pulse':
          // no extra params needed
          break;
      }

      const { data: jobId, error } = await supabase.rpc('rpc_request_report', {
        p_report_type: reportType,
        p_parameters:  parameters,
      });
      if (error) throw error;

      if (!jobId) throw new Error('Failed to create report job');

      if (!user?.id || !profile?.company_id) throw new Error('User session is not ready');

      const signedUrl = await generateAndUploadReport(
        jobId,
        reportType,
        parameters,
        supabase,
        user.id,
        profile.company_id,
      );

      if (signedUrl) {
        await Linking.openURL(signedUrl);
      }

      router.replace('/intelligence?section=archives');
    } catch (error: any) {
      console.error('Report generation error:', error);
      Alert.alert('Error', error.message || 'Failed to generate report');
    } finally {
      setLoading(false);
    }
  };

  const temporalMode = getTemporalMode(reportType);
  const legacyTypes  = REPORT_TYPES.filter(t => t.group === 'legacy');
  const analyticsTypes = REPORT_TYPES.filter(t => t.group === 'analytics');

  return (
    <View className="flex-1 bg-surface-background">
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView className="flex-1" showsVerticalScrollIndicator={false}>
        <View className="p-12 max-w-[1200px] mx-auto w-full pb-40">
          {pipelines.length === 0 ? (
            <View className="py-20 items-center justify-center">
              <View className="bg-surface-card p-12 rounded-[3rem] border border-surface-border items-center max-w-[600px] premium-shadow">
                <View className="w-20 h-20 bg-brand-primary/10 rounded-full items-center justify-center mb-6">
                  <FontAwesome name="file-text-o" size={32} color="rgb(var(--brand-primary))" />
                </View>
                {hasPermission('pipeline.edit') ? (
                  <>
                    <Text className="text-typography-main text-3xl font-black mb-2 text-center">Setup Required</Text>
                    <Text className="text-typography-muted text-center mb-8 leading-relaxed">
                      No pipelines detected. Report generation requires at least one active workflow pipeline to analyze.
                    </Text>
                    <TouchableOpacity
                      onPress={() => router.push('/admin/pipelines')}
                      className="bg-brand-primary px-10 py-4 rounded-2xl active:scale-95 transition-all"
                    >
                      <Text className="text-typography-main font-black uppercase tracking-widest text-xs">Configure Pipelines</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <View className="bg-state-info-dim border border-state-info/20 p-8 rounded-3xl w-full">
                    <View className="flex-row items-start">
                      <FontAwesome name="info-circle" size={20} color="rgb(var(--state-info))" style={{ marginTop: 4 }} />
                      <View className="ml-5 flex-1">
                        <Text className="text-typography-main text-lg font-black mb-1">Access Restricted</Text>
                        <Text className="text-typography-muted text-sm font-bold leading-relaxed">
                          No pipelines are available. Contact your company Admin.
                        </Text>
                      </View>
                    </View>
                  </View>
                )}
              </View>
            </View>
          ) : (
            <>
              {/* ── Page Header ── */}
              <View className="flex-row justify-between items-end mb-16">
                <View>
                  <View className="flex-row items-center mb-4">
                    <View className="h-3 w-3 rounded-full bg-brand-primary mr-3 animate-pulse" />
                    <Text className="text-brand-primary font-black uppercase tracking-[0.4em] text-xs">Mission Analytics</Text>
                  </View>
                  <Text className="text-typography-main text-6xl font-black tracking-tighter">Report Architect</Text>
                  <Text className="text-typography-muted text-lg font-medium mt-2 max-w-2xl leading-8">
                    Configure and execute deep-packet analytics reports. All generated reports are encrypted and archived for strategic review.
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={handleGenerateReport}
                  disabled={loading}
                  className={`px-12 py-6 rounded-[32px] flex-row items-center transition-all ${loading ? 'bg-surface-border opacity-50' : 'bg-brand-primary premium-shadow active:scale-95'}`}
                >
                  {loading ? (
                    <ActivityIndicator size="small" color="white" />
                  ) : (
                    <>
                      <FontAwesome name="bolt" size={16} color="white" style={{ marginRight: 10 }} />
                      <Text className="text-white font-black uppercase tracking-[0.2em] text-sm">Deploy Generation</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>

              <View className="flex-row gap-12">
                {/* ── Left Column ── */}
                <View className="flex-[1.5] gap-10">

                  {/* Step 1 — Architecture Type */}
                  <View className="bg-surface-card p-10 rounded-[48px] border border-surface-border">
                    <Text className="text-typography-muted text-xs font-black uppercase tracking-[0.2em] mb-8 opacity-60">01. Architecture Type</Text>

                    {/* Legacy reports */}
                    <Text className="text-typography-dim text-[9px] font-black uppercase tracking-[0.3em] mb-4">Standard Reports</Text>
                    <View className="gap-3 mb-8">
                      {legacyTypes.map(opt => (
                        <TypeCard key={opt.value} opt={opt} selected={reportType === opt.value} onPress={() => setReportType(opt.value)} />
                      ))}
                    </View>

                    {/* Analytics engine reports */}
                    <View className="flex-row items-center gap-3 mb-4">
                      <Text className="text-typography-dim text-[9px] font-black uppercase tracking-[0.3em]">Analytics Engine</Text>
                      <View className="flex-1 h-px bg-brand-primary/20" />
                      <View className="bg-brand-primary/10 px-2 py-0.5 rounded-full">
                        <Text className="text-brand-primary text-[8px] font-black uppercase tracking-widest">New</Text>
                      </View>
                    </View>
                    <View className="gap-3">
                      {analyticsTypes.map(opt => (
                        <TypeCard key={opt.value} opt={opt} selected={reportType === opt.value} onPress={() => setReportType(opt.value)} />
                      ))}
                    </View>
                  </View>

                  {/* Step 2 — Temporal Scope (conditional) */}
                  {temporalMode !== 'none' && (
                    <View className="bg-surface-card p-10 rounded-[48px] border border-surface-border">
                      <Text className="text-typography-muted text-xs font-black uppercase tracking-[0.2em] mb-8 opacity-60">02. Temporal Scope</Text>

                      {temporalMode === 'range' && (
                        <>
                          <View className="flex-row gap-4 mb-6">
                            {(['7', '30', '90'] as const).map(d => (
                              <TouchableOpacity
                                key={d}
                                onPress={() => setTimeFrame(d)}
                                className={`flex-1 py-5 rounded-2xl border items-center transition-all ${timeFrame === d ? 'border-brand-primary bg-brand-primary' : 'border-surface-border bg-surface-background/40'}`}
                              >
                                <Text className={`font-black uppercase tracking-widest ${timeFrame === d ? 'text-white' : 'text-typography-main'}`}>{d} Days</Text>
                              </TouchableOpacity>
                            ))}
                            <TouchableOpacity
                              onPress={() => setTimeFrame('custom')}
                              className={`flex-1 py-5 rounded-2xl border items-center transition-all ${timeFrame === 'custom' ? 'border-brand-primary bg-brand-primary' : 'border-surface-border bg-surface-background/40'}`}
                            >
                              <Text className={`font-black uppercase tracking-widest ${timeFrame === 'custom' ? 'text-white' : 'text-typography-main'}`}>Custom</Text>
                            </TouchableOpacity>
                          </View>
                          {timeFrame === 'custom' && (
                            <View className="flex-row gap-4">
                              <View className="flex-1">
                                <Text className="text-typography-muted text-[10px] font-bold uppercase mb-2 ml-1">Start Date</Text>
                                <RNTextInput
                                  placeholder="YYYY-MM-DD"
                                  value={dateStart}
                                  onChangeText={setDateStart}
                                  className="border border-surface-border bg-surface-background rounded-2xl p-5 text-typography-main font-bold"
                                  placeholderTextColor="rgb(var(--text-muted))"
                                />
                              </View>
                              <View className="flex-1">
                                <Text className="text-typography-muted text-[10px] font-bold uppercase mb-2 ml-1">End Date</Text>
                                <RNTextInput
                                  placeholder="YYYY-MM-DD"
                                  value={dateEnd}
                                  onChangeText={setDateEnd}
                                  className="border border-surface-border bg-surface-background rounded-2xl p-5 text-typography-main font-bold"
                                  placeholderTextColor="rgb(var(--text-muted))"
                                />
                              </View>
                            </View>
                          )}
                        </>
                      )}

                      {temporalMode === 'series' && (
                        <>
                          <Text className="text-typography-muted text-[10px] font-bold uppercase mb-3 ml-1">Period Granularity</Text>
                          <View className="flex-row gap-4 mb-6">
                            {(['week', 'month', 'year'] as const).map(p => (
                              <TouchableOpacity
                                key={p}
                                onPress={() => setPeriodType(p)}
                                className={`flex-1 py-5 rounded-2xl border items-center transition-all ${periodType === p ? 'border-brand-primary bg-brand-primary' : 'border-surface-border bg-surface-background/40'}`}
                              >
                                <Text className={`font-black capitalize tracking-widest ${periodType === p ? 'text-white' : 'text-typography-main'}`}>{p}</Text>
                              </TouchableOpacity>
                            ))}
                          </View>
                          <Text className="text-typography-muted text-[10px] font-bold uppercase mb-2 ml-1">Number of Periods</Text>
                          <RNTextInput
                            value={nPeriods}
                            onChangeText={setNPeriods}
                            keyboardType="numeric"
                            placeholder="12"
                            className="border border-surface-border bg-surface-background rounded-2xl p-5 text-typography-main font-bold"
                            placeholderTextColor="rgb(var(--text-muted))"
                          />
                        </>
                      )}
                    </View>
                  )}
                </View>

                {/* ── Right Column — Tactical Parameters ── */}
                <View className="flex-1">
                  <View className="bg-surface-card p-10 rounded-[48px] border border-surface-border sticky top-12">
                    <Text className="text-typography-muted text-xs font-black uppercase tracking-[0.2em] mb-8 opacity-60">03. Tactical Parameters</Text>
                    <ScrollView showsVerticalScrollIndicator={false} className="max-h-[70vh]">

                      {/* ── Legacy report params ── */}
                      {(reportType === 'general' || reportType === 'workflow_analysis') && (
                        <>
                          <ParameterSection title="Pipeline Focus"   options={pipelines} value={pipelineId} onSelect={setPipelineId} placeholder="All Pipelines" />
                          <ParameterSection title="Unit Allocation"  options={teams}     value={teamId}     onSelect={setTeamId}     placeholder="All Teams" />
                          <ParameterSection title="Individual Asset" options={workers}   value={workerId}   onSelect={setWorkerId}   placeholder="All Personnel" labelKey="full_name" />
                          <ParameterSection title="Priority Tier"
                            options={[{ id: 'low', name: 'Low' }, { id: 'medium', name: 'Medium' }, { id: 'high', name: 'High' }, { id: 'critical', name: 'Critical' }]}
                            value={priorityFilter} onSelect={setPriorityFilter} placeholder="All Tiers"
                          />
                        </>
                      )}

                      {reportType === 'worker_comparison' && (
                        <>
                          <ParameterSection title="Asset Alpha" options={workers} value={workerA_id} onSelect={setWorkerA_id} placeholder="Select Worker" labelKey="full_name" />
                          <ParameterSection title="Asset Beta"  options={workers} value={workerB_id} onSelect={setWorkerB_id} placeholder="Select Worker" labelKey="full_name" />
                        </>
                      )}

                      {reportType === 'team_comparison' && (
                        <>
                          <ParameterSection title="Unit Alpha" options={teams} value={teamA_id} onSelect={setTeamA_id} placeholder="Select Team" />
                          <ParameterSection title="Unit Beta"  options={teams} value={teamB_id} onSelect={setTeamB_id} placeholder="Select Team" />
                        </>
                      )}

                      {/* ── Analytics engine params ── */}
                      {(reportType === 'user_performance_series' || reportType === 'user_performance_summary') && (
                        <ParameterSection title="Worker" options={workers} value={singleUserId} onSelect={setSingleUserId} placeholder="Select Worker" labelKey="full_name" required />
                      )}

                      {(reportType === 'pipeline_stage_dwell' || reportType === 'pipeline_throughput') && (
                        <ParameterSection title="Pipeline" options={pipelines} value={pipelineId} onSelect={setPipelineId} placeholder="Select Pipeline" required />
                      )}

                      {reportType === 'personnel_comparison' && (
                        <>
                          <View className="mb-8">
                            <View className="flex-row items-center mb-4">
                              <Text className="text-typography-main text-xs font-black uppercase tracking-widest flex-1">Workers</Text>
                              <Text className="text-typography-muted text-[10px]">{selectedUserIds.length} selected (min 2)</Text>
                            </View>
                            <View className="flex-row flex-wrap gap-2">
                              {workers.map(w => {
                                const active = selectedUserIds.includes(w.id);
                                return (
                                  <TouchableOpacity
                                    key={w.id}
                                    onPress={() => toggleMultiUser(w.id)}
                                    className={`px-4 py-2.5 rounded-xl border transition-all ${active ? 'bg-brand-primary border-brand-primary' : 'bg-surface-background border-surface-border'}`}
                                  >
                                    <Text className={`text-[11px] font-black uppercase tracking-tighter ${active ? 'text-white' : 'text-typography-main'}`}>
                                      {w.full_name}
                                    </Text>
                                  </TouchableOpacity>
                                );
                              })}
                            </View>
                          </View>

                          {selectedUserIds.length > 0 && (
                            <View className="mb-8">
                              <Text className="text-typography-main text-xs font-black uppercase tracking-widest mb-4">Daily Rate (USD) — Optional</Text>
                              {selectedUserIds.map(uid => {
                                const w = workers.find(x => x.id === uid);
                                if (!w) return null;
                                return (
                                  <View key={uid} className="flex-row items-center gap-3 mb-3">
                                    <Text className="text-typography-muted text-xs font-bold flex-1" numberOfLines={1}>{w.full_name}</Text>
                                    <RNTextInput
                                      value={salaries[uid]?.toString() ?? ''}
                                      onChangeText={v => setSalaries(prev => ({ ...prev, [uid]: parseFloat(v) || 0 }))}
                                      keyboardType="numeric"
                                      placeholder="0.00"
                                      className="border border-surface-border bg-surface-background rounded-xl px-4 py-3 text-typography-main font-bold w-28 text-right"
                                      placeholderTextColor="rgb(var(--text-muted))"
                                    />
                                  </View>
                                );
                              })}
                            </View>
                          )}
                        </>
                      )}

                      {reportType === 'targets_status' && (
                        <View className="bg-brand-primary/5 border border-brand-primary/20 p-6 rounded-3xl">
                          <View className="flex-row items-center gap-3 mb-3">
                            <FontAwesome name="bullseye" size={16} color="var(--color-primary)" />
                            <Text className="text-typography-main font-black text-sm">Company-Wide Scope</Text>
                          </View>
                          <Text className="text-typography-muted text-xs leading-5">
                            This report includes all active, hit, and expired performance targets across every pipeline for your company. No additional filters required.
                          </Text>
                        </View>
                      )}

                      {reportType === 'personal_pulse' && (
                        <View className="bg-brand-primary/5 border border-brand-primary/20 p-6 rounded-3xl">
                          <View className="flex-row items-center gap-3 mb-3">
                            <FontAwesome name="heartbeat" size={16} color="var(--color-primary)" />
                            <Text className="text-typography-main font-black text-sm">Your Current Session</Text>
                          </View>
                          <Text className="text-typography-muted text-xs leading-5">
                            Captures a real-time snapshot of your daily points, monthly points, active session time, and flap rate score at the moment of generation.
                          </Text>
                        </View>
                      )}

                    </ScrollView>

                    <View className="mt-10 pt-10 border-t border-surface-border">
                      <View className="bg-surface-background p-6 rounded-3xl border border-surface-border">
                        <View className="flex-row items-center mb-4">
                          <FontAwesome name="shield" size={14} color="var(--color-primary)" style={{ marginRight: 10 }} />
                          <Text className="text-[10px] font-black uppercase tracking-widest text-typography-main">Data Sovereignty</Text>
                        </View>
                        <Text className="text-typography-muted text-xs leading-5 font-medium">
                          Reports are generated client-side and downloaded immediately. High-volume data sets may take 10–30 seconds to compile.
                        </Text>
                      </View>
                    </View>
                  </View>
                </View>
              </View>
            </>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function TypeCard({ opt, selected, onPress }: { opt: typeof REPORT_TYPES[number]; selected: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      className={`p-6 rounded-[32px] border flex-row items-center transition-all ${selected ? 'border-brand-primary bg-brand-primary/10' : 'border-surface-border bg-surface-background/40 hover:bg-surface-overlay'}`}
    >
      <View className={`h-16 w-16 items-center justify-center rounded-2xl ${selected ? 'bg-brand-primary' : 'bg-surface-card'}`}>
        <FontAwesome name={opt.icon as any} size={22} color={selected ? 'white' : 'rgb(var(--brand-accent) / 0.4)'} />
      </View>
      <View className="ml-6 flex-1">
        <Text className={`text-lg font-black ${selected ? 'text-brand-primary' : 'text-typography-main'}`}>{opt.label}</Text>
        <Text className="text-typography-muted mt-1 font-medium text-sm">{opt.desc}</Text>
      </View>
      {selected && (
        <View className="h-8 w-8 rounded-full bg-brand-primary items-center justify-center">
          <FontAwesome name="check" size={12} color="white" />
        </View>
      )}
    </TouchableOpacity>
  );
}

function ParameterSection({ title, options, value, onSelect, placeholder, labelKey = 'name', required = false }: any) {
  return (
    <View className="mb-8">
      <View className="flex-row items-center mb-4">
        <Text className="text-typography-main text-xs font-black uppercase tracking-widest flex-1">{title}</Text>
        {required && <Text className="text-state-danger text-[9px] font-black uppercase tracking-widest">Required</Text>}
      </View>
      <View className="flex-row flex-wrap gap-2">
        {!required && (
          <TouchableOpacity
            onPress={() => onSelect('')}
            className={`px-4 py-2.5 rounded-xl border transition-all ${!value ? 'bg-brand-primary border-brand-primary' : 'bg-surface-background border-surface-border hover:bg-surface-overlay'}`}
          >
            <Text className={`text-[11px] font-black uppercase tracking-tighter ${!value ? 'text-white' : 'text-typography-muted'}`}>{placeholder}</Text>
          </TouchableOpacity>
        )}
        {options.map((opt: any) => (
          <TouchableOpacity
            key={opt.id}
            onPress={() => onSelect(opt.id)}
            className={`px-4 py-2.5 rounded-xl border transition-all ${value === opt.id ? 'bg-brand-primary border-brand-primary' : 'bg-surface-background border-surface-border hover:bg-surface-overlay'}`}
          >
            <Text className={`text-[11px] font-black uppercase tracking-tighter ${value === opt.id ? 'text-white' : 'text-typography-main'}`}>{opt[labelKey]}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}
