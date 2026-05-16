import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Stack, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
    TextInput as RNTextInput,
    ScrollView,
    Text,
    TouchableOpacity,
    View
} from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { generateAndUploadReport } from './reports/generate';

const BRAND = 'rgb(99,102,241)';
const BRAND_DIM = 'rgba(99,102,241,0.15)';

function fmt(s: number) {
  return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
}

function GenerationProgress({ current, total, elapsed }: { current: number; total: number; elapsed: number }) {
  const size = 148;
  const stroke = 10;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const pct = total > 0 ? current / total : 0;
  const eta = current > 1 && elapsed > 1 ? Math.round((elapsed / current) * (total - current)) : null;

  return (
    <View style={{ alignItems: 'center', gap: 6 }}>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={BRAND_DIM} strokeWidth={stroke} fill="none" />
          <Circle
            cx={size / 2} cy={size / 2} r={r}
            stroke={BRAND} strokeWidth={stroke} fill="none"
            strokeDasharray={circ} strokeDashoffset={circ * (1 - pct)}
            strokeLinecap="round" rotation="-90" origin={`${size / 2}, ${size / 2}`}
          />
        </Svg>
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: 'white', fontWeight: '900', fontSize: 24, fontVariant: ['tabular-nums'] }}>
            {current}/{total}
          </Text>
          <Text style={{ color: 'rgba(255,255,255,0.45)', fontSize: 11, marginTop: 2 }}>reports</Text>
        </View>
      </View>
      <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
        {fmt(elapsed)}
      </Text>
      {eta !== null && eta > 0 ? (
        <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 11 }}>~{fmt(eta)} remaining</Text>
      ) : null}
    </View>
  );
}

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
  | 'personal_pulse'
  | 'projects';

type TemporalMode = 'range' | 'series' | 'none';

function getTemporalMode(type: ReportType, tp: Record<string, any> = {}): TemporalMode {
  if (type === 'user_performance_series' || type === 'pipeline_throughput') return 'series';
  if (type === 'targets_status' || type === 'personal_pulse') return 'none';
  if (type === 'projects') return tp.date_scoped ? 'range' : 'none';
  return 'range';
}

const REPORT_TYPES: {
  value: ReportType;
  label: string;
  desc: string;
  icon: string;
  group: 'legacy' | 'analytics';
}[] = [
  { value: 'general',                  label: 'Overview',                    desc: 'Organization or pipeline metrics',                    icon: 'bar-chart',     group: 'legacy'    },
  { value: 'worker_comparison',         label: 'People Comparison',          desc: 'Compare people in pairs or groups',                   icon: 'users',         group: 'legacy'    },
  { value: 'team_comparison',           label: 'Team Comparison',            desc: 'Efficiency metrics across teams',                     icon: 'group',         group: 'legacy'    },
  { value: 'workflow_analysis',         label: 'Pipeline Review',            desc: 'Stage-by-stage efficiency and delay deep-dive',       icon: 'rocket',        group: 'legacy'    },
  { value: 'user_performance_series',   label: 'Performance Timeline',       desc: 'Period-by-period output, session hours and efficiency', icon: 'line-chart',    group: 'analytics' },
  { value: 'user_performance_summary',  label: 'Performance Summary',        desc: 'All aggregated stats for one person over a date range', icon: 'user',          group: 'analytics' },
  { value: 'pipeline_stage_dwell',      label: 'Stage Dwell Analysis',          desc: 'Avg/median/P75 dwell, bottleneck flag, reversal counts',  icon: 'clock-o',       group: 'analytics' },
  { value: 'pipeline_throughput',       label: 'Pipeline Throughput Report',    desc: 'Period success/failure rates across a pipeline',          icon: 'area-chart',    group: 'analytics' },
  { value: 'personnel_comparison',      label: 'People Cost Comparison',     desc: 'Cost analysis, points/hour and efficiency across people', icon: 'balance-scale', group: 'analytics' },
  { value: 'targets_status',            label: 'Objectives & SLA Report',       desc: 'All active, hit, and expired performance targets',        icon: 'bullseye',      group: 'analytics' },
  { value: 'personal_pulse',            label: 'Personal Snapshot',         desc: 'Your daily and monthly points, session time and flap rate', icon: 'heartbeat',     group: 'analytics' },
  { value: 'projects',                  label: 'Projects Status',           desc: 'Folder-of-tasks completion, throughput, and projected ETA', icon: 'folder-open-o', group: 'analytics' },
];

export default function ReportGeneratorDesktop() {
  const router = useRouter();
  const { hasPermission, user, profile } = useAuth();

  // Multi-select: one or more report types per generation
  const [selectedTypes, setSelectedTypes] = useState<ReportType[]>(['general']);
  // Per-type params: keyed by ReportType, value is that type's specific params
  const [typeParams, setTypeParams]       = useState<Record<string, Record<string, any>>>({});

  // Shared temporal scope
  const [timeFrame, setTimeFrame]   = useState<'7' | '30' | '90' | 'custom'>('30');
  const [dateStart, setDateStart]   = useState('');
  const [dateEnd, setDateEnd]       = useState('');

  const [pipelines, setPipelines] = useState<any[]>([]);
  const [teams, setTeams]         = useState<any[]>([]);
  const [workers, setWorkers]     = useState<any[]>([]);
  const [projects, setProjects]   = useState<any[]>([]);
  const [loading, setLoading]         = useState(false);
  const [genError, setGenError]       = useState<string | null>(null);
  const [genProgress, setGenProgress] = useState<{ current: number; total: number } | null>(null);
  const [elapsed, setElapsed]         = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => { loadFilterOptions(); }, []);

  // Block browser tab close / refresh while generating
  useEffect(() => {
    if (!loading || typeof window === 'undefined') return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [loading]);

  const loadFilterOptions = async () => {
    const [pipeRes, teamRes, workerRes, projectRes] = await Promise.all([
      supabase.from('pipelines').select('id, name').is('deleted_at', null).order('name'),
      supabase.from('teams').select('id, name').is('deleted_at', null).order('name'),
      supabase.from('users').select('id, full_name').is('deleted_at', null).order('full_name'),
      supabase.from('projects').select('id, name').is('deleted_at', null).order('name'),
    ]);
    setPipelines(pipeRes.data || []);
    setTeams(teamRes.data || []);
    setWorkers(workerRes.data || []);
    setProjects(projectRes.data || []);
  };

  const toggleType = (type: ReportType) => {
    setSelectedTypes(prev =>
      prev.includes(type)
        ? prev.length > 1 ? prev.filter(t => t !== type) : prev  // never empty
        : [...prev, type]
    );
  };

  const getParam = (type: ReportType, key: string, def: any = '') =>
    (typeParams[type] || {})[key] ?? def;

  const setParam = (type: ReportType, key: string, value: any) =>
    setTypeParams(prev => ({ ...prev, [type]: { ...(prev[type] || {}), [key]: value } }));

  const toggleMultiUser = (type: ReportType, uid: string) => {
    const cur: string[] = getParam(type, 'user_ids', []);
    setParam(type, 'user_ids', cur.includes(uid) ? cur.filter(x => x !== uid) : [...cur, uid]);
  };

  // Whether to show the shared date-range picker (any selected type uses range mode)
  const needsDateRange = selectedTypes.some(t => getTemporalMode(t, typeParams[t] || {}) === 'range');

  const buildTemporalParams = () => {
    let days = 30;
    let dateStartParam: string | null = null;
    let dateEndParam: string | null   = null;

    if (timeFrame === 'custom') {
      dateStartParam = dateStart ? new Date(dateStart).toISOString() : null;
      dateEndParam   = dateEnd   ? new Date(dateEnd).toISOString()   : null;
    } else {
      days = parseInt(timeFrame);
      const now = new Date();
      dateEndParam   = now.toISOString();
      dateStartParam = new Date(now.getTime() - days * 86400000).toISOString();
    }
    return { days, dateStartParam, dateEndParam };
  };

  const buildTypeParameters = (type: ReportType) => {
    const tp = typeParams[type] || {};
    const { days, dateStartParam, dateEndParam } = buildTemporalParams();
    const params: Record<string, any> = {};

    const tMode = getTemporalMode(type, tp);
    if (tMode === 'range') {
      params.days       = days;
      params.date_start = dateStartParam;
      params.date_end   = dateEndParam;
    } else if (tMode === 'series') {
      params.period_type = tp.period_type || 'month';
      params.n_periods   = parseInt(tp.n_periods || '12') || 12;
    }

    switch (type) {
      case 'general':
      case 'workflow_analysis':
        if (tp.pipeline_id) params.pipeline_id = tp.pipeline_id;
        if (tp.team_id)     params.team_id     = tp.team_id;
        if (tp.worker_id)   params.worker_id   = tp.worker_id;
        if (tp.priority)    params.priority    = tp.priority;
        break;
      case 'worker_comparison':
        params.user_ids = tp.user_ids || [];
        break;
      case 'team_comparison':
        params.team_ids = tp.team_ids || [];
        break;
      case 'user_performance_series':
      case 'user_performance_summary':
        params.user_id = tp.user_id || '';
        break;
      case 'pipeline_stage_dwell':
      case 'pipeline_throughput':
        params.pipeline_id = tp.pipeline_id || '';
        break;
      case 'personnel_comparison':
        params.user_ids  = tp.user_ids  || [];
        params.salaries  = tp.salaries  || {};
        break;
      case 'projects':
        params.project_ids = tp.project_ids || [];
        break;
    }
    return params;
  };

  // Expand selected types into individual jobs, broadcasting over all workers/pipelines when none is selected
  const expandJobs = () => {
    const jobs: { reportType: string; parameters: Record<string, any> }[] = [];
    for (const type of selectedTypes) {
      const params = buildTypeParameters(type);
      if ((type === 'user_performance_series' || type === 'user_performance_summary') && !params.user_id) {
        workers.forEach(w => jobs.push({ reportType: type, parameters: { ...params, user_id: w.id } }));
      } else if ((type === 'pipeline_stage_dwell' || type === 'pipeline_throughput') && !params.pipeline_id) {
        pipelines.forEach(p => jobs.push({ reportType: type, parameters: { ...params, pipeline_id: p.id } }));
      } else if (type === 'worker_comparison' && (params.user_ids || []).length === 0) {
        jobs.push({ reportType: type, parameters: { ...params, user_ids: workers.map(w => w.id) } });
      } else if (type === 'team_comparison' && (params.team_ids || []).length === 0) {
        jobs.push({ reportType: type, parameters: { ...params, team_ids: teams.map(t => t.id) } });
      } else if (type === 'personnel_comparison' && (params.user_ids || []).length < 2) {
        jobs.push({ reportType: type, parameters: { ...params, user_ids: workers.map(w => w.id) } });
      } else {
        jobs.push({ reportType: type, parameters: params });
      }
    }
    return jobs;
  };

  const handleGenerateReport = async () => {
    setGenError(null);
    setGenProgress(null);
    setElapsed(0);
    try {
      setLoading(true);
      const t0 = Date.now();
      timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 1000);

      if (needsDateRange && timeFrame === 'custom' && (!dateStart || !dateEnd)) {
        setGenError('Please provide both start and end dates');
        return;
      }



      if (!user?.id || !profile?.company_id) throw new Error('User session is not ready');

      const expanded = expandJobs();

      // If exactly one type selected and no expansion happened → single report
      // If multiple types, all with specific selections → combine into multi_report
      // If any expansion happened → run as separate individual jobs
      const wasExpanded = expanded.length !== selectedTypes.length;

      let jobs: { reportType: string; parameters: Record<string, any> }[];
      if (!wasExpanded && selectedTypes.length > 1) {
        jobs = [{ reportType: 'multi_report', parameters: { modules: selectedTypes.map(t => ({ type: t, parameters: buildTypeParameters(t) })) } }];
      } else {
        jobs = expanded;
      }

      setGenProgress({ current: 0, total: jobs.length });

      const createdJobIds: string[] = [];
      for (let i = 0; i < jobs.length; i++) {
        setGenProgress({ current: i + 1, total: jobs.length });
        const { reportType, parameters } = jobs[i];
        const taggedParams = { ...parameters, _generated_from: 'desktop' };
        const { data: jobId, error } = await supabase.rpc('rpc_request_report', {
          p_report_type: reportType,
          p_parameters:  taggedParams,
        });
        if (error) throw error;
        if (!jobId) throw new Error('Failed to create report job');
        createdJobIds.push(jobId);
        await generateAndUploadReport(jobId, reportType, taggedParams, supabase, user.id, profile.company_id);
      }

      // Post-loop verification: confirm every row is 'completed' in the DB before navigating away.
      const { data: verifyRows } = await supabase
        .from('reporting_jobs')
        .select('id, status')
        .in('id', createdJobIds);
      const incomplete = (verifyRows || []).filter(r => r.status !== 'completed');
      if (incomplete.length > 0) {
        setGenError(`${incomplete.length} of ${createdJobIds.length} report(s) didn't reach completed status. Check the Reports list — the row may still be processing or failed.`);
        return;
      }

      router.replace('/intelligence/reports');
    } catch (error: any) {
      console.error('Report generation error:', error);
      setGenError(error.message || 'Failed to generate report');
    } finally {
      if (timerRef.current) clearInterval(timerRef.current);
      setLoading(false);
      setGenProgress(null);
    }
  };

  const legacyTypes    = REPORT_TYPES.filter(t => t.group === 'legacy');
  const analyticsTypes = REPORT_TYPES.filter(t => t.group === 'analytics');
  const isMulti        = selectedTypes.length > 1;

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
                    Configure and execute deep-packet analytics reports. Select one or combine multiple report types into a single document.
                  </Text>
                </View>
                {loading && genProgress ? (
                  <GenerationProgress current={genProgress.current} total={genProgress.total} elapsed={elapsed} />
                ) : (
                  <TouchableOpacity
                    onPress={handleGenerateReport}
                    disabled={loading}
                    className="px-12 py-6 rounded-[32px] flex-row items-center bg-brand-primary premium-shadow active:scale-95"
                  >
                    <FontAwesome name="bolt" size={16} color="white" style={{ marginRight: 10 }} />
                    <Text className="text-white font-black uppercase tracking-[0.2em] text-sm">
                      {isMulti ? `Deploy ${selectedTypes.length} Reports` : 'Deploy Generation'}
                    </Text>
                  </TouchableOpacity>
                )}
              </View>

              {loading && (
                <View className="bg-state-warning/10 border border-state-warning/30 rounded-2xl px-8 py-4 mb-4 flex-row items-center gap-4">
                  <FontAwesome name="warning" size={15} color="rgb(var(--state-warning))" />
                  <Text className="text-state-warning font-semibold text-sm flex-1">
                    Don't close or navigate away — reports are actively being generated. Leaving will cancel the remaining jobs.
                  </Text>
                </View>
              )}

              {genError && (
                <View className="bg-state-danger/10 border border-state-danger/30 rounded-2xl px-8 py-5 mb-8 flex-row items-center gap-4">
                  <FontAwesome name="exclamation-circle" size={18} color="rgb(var(--state-danger))" />
                  <Text className="text-state-danger font-bold flex-1">{genError}</Text>
                  <TouchableOpacity onPress={() => setGenError(null)}>
                    <FontAwesome name="times" size={16} color="rgb(var(--state-danger))" />
                  </TouchableOpacity>
                </View>
              )}

              <View className="flex-row gap-12">
                {/* ── Left Column ── */}
                <View className="flex-[1.5] gap-10">

                  {/* Step 1 — Architecture Type */}
                  <View className="bg-surface-card p-10 rounded-[48px] border border-surface-border">
                    <View className="flex-row items-center justify-between mb-8">
                      <Text className="text-typography-muted text-xs font-black uppercase tracking-[0.2em] opacity-60">01. Architecture Type</Text>
                      {isMulti && (
                        <View className="bg-brand-primary/10 border border-brand-primary/30 px-3 py-1 rounded-full flex-row items-center gap-2">
                          <FontAwesome name="files-o" size={10} color="rgb(var(--brand-primary))" />
                          <Text className="text-brand-primary text-[9px] font-black uppercase tracking-widest">{selectedTypes.length} Combined</Text>
                        </View>
                      )}
                    </View>

                    <Text className="text-typography-dim text-[9px] font-semibold uppercase tracking-[0.18em] mb-4">Standard Reports</Text>
                    <View className="gap-3 mb-8">
                      {legacyTypes.map(opt => (
                        <TypeCard key={opt.value} opt={opt} selected={selectedTypes.includes(opt.value)} onPress={() => toggleType(opt.value)} />
                      ))}
                    </View>

                    <View className="flex-row items-center gap-3 mb-4">
                      <Text className="text-typography-dim text-[9px] font-semibold uppercase tracking-[0.18em]">Analytics Engine</Text>
                      <View className="flex-1 h-px bg-brand-primary/20" />
                      <View className="bg-brand-primary/10 px-2 py-0.5 rounded-full">
                        <Text className="text-brand-primary text-[8px] font-semibold uppercase tracking-widest">New</Text>
                      </View>
                    </View>
                    <View className="gap-3">
                      {analyticsTypes.map(opt => (
                        <TypeCard key={opt.value} opt={opt} selected={selectedTypes.includes(opt.value)} onPress={() => toggleType(opt.value)} />
                      ))}
                    </View>
                  </View>

                  {/* Step 2 — Temporal Scope (shown when any selected type uses a date range) */}
                  {needsDateRange && (
                    <View className="bg-surface-card p-10 rounded-[48px] border border-surface-border">
                      <Text className="text-typography-muted text-xs font-black uppercase tracking-[0.2em] mb-8 opacity-60">02. Temporal Scope</Text>

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
                    </View>
                  )}
                </View>

                {/* ── Right Column — Tactical Parameters ── */}
                <View className="flex-1">
                  <View className="bg-surface-card p-10 rounded-[48px] border border-surface-border sticky top-12">
                    <Text className="text-typography-muted text-xs font-black uppercase tracking-[0.2em] mb-8 opacity-60">03. Tactical Parameters</Text>
                    <ScrollView showsVerticalScrollIndicator={false} className="max-h-[70vh]">

                      {selectedTypes.map((type, idx) => {
                        const meta = REPORT_TYPES.find(r => r.value === type)!;
                        return (
                          <View key={type} className={`${idx > 0 ? 'mt-8 pt-8 border-t border-surface-border' : ''}`}>
                            {isMulti && (
                              <View className="flex-row items-center gap-3 mb-6">
                                <View className="w-6 h-6 bg-brand-primary rounded-lg items-center justify-center">
                                  <FontAwesome name={meta.icon as any} size={11} color="white" />
                                </View>
                                <Text className="text-typography-main text-xs font-black uppercase tracking-wider flex-1">{meta.label}</Text>
                              </View>
                            )}

                            <TypeParamPanel
                              type={type}
                              params={typeParams[type] || {}}
                              setParam={(k, v) => setParam(type, k, v)}
                              toggleMultiUser={(uid) => toggleMultiUser(type, uid)}
                              pipelines={pipelines}
                              teams={teams}
                              workers={workers}
                              projects={projects}
                            />
                          </View>
                        );
                      })}

                    </ScrollView>

                    <View className="mt-10 pt-10 border-t border-surface-border">
                      <View className="bg-surface-background p-6 rounded-3xl border border-surface-border">
                        <View className="flex-row items-center mb-4">
                          <FontAwesome name="shield" size={14} color="var(--color-primary)" style={{ marginRight: 10 }} />
                          <Text className="text-[10px] font-black uppercase tracking-widest text-typography-main">Data Sovereignty</Text>
                        </View>
                        <Text className="text-typography-muted text-xs leading-5 font-medium">
                          {isMulti
                            ? `Generating a combined ${selectedTypes.length}-module report. Data is fetched and assembled client-side before upload.`
                            : 'Reports are generated client-side and downloaded immediately. High-volume data sets may take 10–30 seconds to compile.'
                          }
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

// ── TypeCard ──────────────────────────────────────────────────────────────────

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
      {/* Checkbox indicator — shows for all selected, not just one */}
      <View className={`h-8 w-8 rounded-full border-2 items-center justify-center ${selected ? 'bg-brand-primary border-brand-primary' : 'border-surface-border'}`}>
        {selected && <FontAwesome name="check" size={12} color="white" />}
      </View>
    </TouchableOpacity>
  );
}

// ── TypeParamPanel ─────────────────────────────────────────────────────────────

function TypeParamPanel({
  type, params, setParam, toggleMultiUser, pipelines, teams, workers, projects,
}: {
  type: ReportType;
  params: Record<string, any>;
  setParam: (key: string, value: any) => void;
  toggleMultiUser: (uid: string) => void;
  pipelines: any[];
  teams: any[];
  workers: any[];
  projects: any[];
}) {
  if (type === 'general' || type === 'workflow_analysis') {
    return (
      <>
        <ParameterSection title="Pipeline Focus"   options={pipelines} value={params.pipeline_id || ''} onSelect={v => setParam('pipeline_id', v)} placeholder="All Pipelines" />
        <ParameterSection title="Unit Allocation"  options={teams}     value={params.team_id     || ''} onSelect={v => setParam('team_id', v)}     placeholder="All Teams" />
        <ParameterSection title="Individual Asset" options={workers}   value={params.worker_id   || ''} onSelect={v => setParam('worker_id', v)}   placeholder="All Personnel" labelKey="full_name" />
        <ParameterSection title="Priority Tier"
          options={[{ id: 'low', name: 'Low' }, { id: 'medium', name: 'Medium' }, { id: 'high', name: 'High' }, { id: 'critical', name: 'Critical' }]}
          value={params.priority || ''} onSelect={v => setParam('priority', v)} placeholder="All Tiers"
        />
      </>
    );
  }

  if (type === 'worker_comparison') {
    const selectedIds: string[] = params.user_ids || [];
    return (
      <View className="mb-8">
        <View className="flex-row items-center mb-4">
          <Text className="text-typography-main text-xs font-semibold uppercase tracking-wide flex-1">People</Text>
          <Text className="text-typography-muted text-[10px]">
            {selectedIds.length === 0 ? 'All people (leave empty)' : `${selectedIds.length} selected`}
          </Text>
        </View>
        <View className="flex-row flex-wrap gap-2">
          {workers.map(w => {
            const active = selectedIds.includes(w.id);
            return (
              <TouchableOpacity
                key={w.id}
                onPress={() => toggleMultiUser(w.id)}
                className={`px-4 py-2.5 rounded-xl border transition-all ${active ? 'bg-brand-primary border-brand-primary' : 'bg-surface-background border-surface-border'}`}
              >
                <Text className={`text-[11px] font-semibold ${active ? 'text-white' : 'text-typography-main'}`}>
                  {w.full_name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text className="text-typography-muted text-[10px] mt-3 leading-4">
          Select 2 people for a head-to-head comparison, 3+ for a group table, or leave empty to compare everyone.
        </Text>
      </View>
    );
  }

  if (type === 'team_comparison') {
    const selectedIds: string[] = params.team_ids || [];
    return (
      <View className="mb-8">
        <View className="flex-row items-center mb-4">
          <Text className="text-typography-main text-xs font-semibold uppercase tracking-wide flex-1">Teams</Text>
          <Text className="text-typography-muted text-[10px]">
            {selectedIds.length === 0 ? 'All teams (leave empty)' : `${selectedIds.length} selected`}
          </Text>
        </View>
        <View className="flex-row flex-wrap gap-2">
          {teams.map(t => {
            const active = selectedIds.includes(t.id);
            return (
              <TouchableOpacity
                key={t.id}
                onPress={() => setParam('team_ids', active ? selectedIds.filter(x => x !== t.id) : [...selectedIds, t.id])}
                className={`px-4 py-2.5 rounded-xl border transition-all ${active ? 'bg-brand-primary border-brand-primary' : 'bg-surface-background border-surface-border'}`}
              >
                <Text className={`text-[11px] font-semibold ${active ? 'text-white' : 'text-typography-main'}`}>
                  {t.name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <Text className="text-typography-muted text-[10px] mt-3 leading-4">
          Select 2 teams for a head-to-head comparison, 3+ for a group table, or leave empty to compare all teams.
        </Text>
      </View>
    );
  }

  if (type === 'user_performance_series' || type === 'user_performance_summary') {
    return (
      <>
        <ParameterSection title="Person" options={workers} value={params.user_id || ''} onSelect={v => setParam('user_id', v)} placeholder="Select Person" labelKey="full_name" required />
        {type === 'user_performance_series' && (
          <SeriesControls
            periodType={params.period_type || 'month'}
            nPeriods={params.n_periods || '12'}
            onPeriodType={v => setParam('period_type', v)}
            onNPeriods={v => setParam('n_periods', v)}
          />
        )}
      </>
    );
  }

  if (type === 'pipeline_stage_dwell') {
    return <ParameterSection title="Pipeline" options={pipelines} value={params.pipeline_id || ''} onSelect={v => setParam('pipeline_id', v)} placeholder="Select Pipeline" required />;
  }

  if (type === 'pipeline_throughput') {
    return (
      <>
        <ParameterSection title="Pipeline" options={pipelines} value={params.pipeline_id || ''} onSelect={v => setParam('pipeline_id', v)} placeholder="Select Pipeline" required />
        <SeriesControls
          periodType={params.period_type || 'month'}
          nPeriods={params.n_periods || '12'}
          onPeriodType={v => setParam('period_type', v)}
          onNPeriods={v => setParam('n_periods', v)}
        />
      </>
    );
  }

  if (type === 'personnel_comparison') {
    const selectedIds: string[] = params.user_ids || [];
    const salaries: Record<string, number> = params.salaries || {};
    return (
      <>
        <View className="mb-8">
          <View className="flex-row items-center mb-4">
            <Text className="text-typography-main text-xs font-semibold uppercase tracking-wide flex-1">People</Text>
            <Text className="text-typography-muted text-[10px]">{selectedIds.length} selected (min 2)</Text>
          </View>
          <View className="flex-row flex-wrap gap-2">
            {workers.map(w => {
              const active = selectedIds.includes(w.id);
              return (
                <TouchableOpacity
                  key={w.id}
                  onPress={() => toggleMultiUser(w.id)}
                  className={`px-4 py-2.5 rounded-xl border transition-all ${active ? 'bg-brand-primary border-brand-primary' : 'bg-surface-background border-surface-border'}`}
                >
                  <Text className={`text-[11px] font-semibold ${active ? 'text-white' : 'text-typography-main'}`}>
                    {w.full_name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {selectedIds.length > 0 && (
          <View className="mb-8">
            <Text className="text-typography-main text-xs font-semibold uppercase tracking-wide mb-4">Daily Rate (USD) — Optional</Text>
            {selectedIds.map(uid => {
              const w = workers.find(x => x.id === uid);
              if (!w) return null;
              return (
                <View key={uid} className="flex-row items-center gap-3 mb-3">
                  <Text className="text-typography-muted text-xs font-bold flex-1" numberOfLines={1}>{w.full_name}</Text>
                  <RNTextInput
                    value={salaries[uid]?.toString() ?? ''}
                    onChangeText={v => setParam('salaries', { ...salaries, [uid]: parseFloat(v) || 0 })}
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
    );
  }

  if (type === 'targets_status') {
    return (
      <View className="bg-brand-primary/5 border border-brand-primary/20 p-6 rounded-3xl">
        <View className="flex-row items-center gap-3 mb-3">
          <FontAwesome name="bullseye" size={16} color="var(--color-primary)" />
          <Text className="text-typography-main font-black text-sm">Company-Wide Scope</Text>
        </View>
        <Text className="text-typography-muted text-xs leading-5">
          Includes all active, hit, and expired performance targets across every pipeline. No filters required.
        </Text>
      </View>
    );
  }

  if (type === 'personal_pulse') {
    return (
      <View className="bg-brand-primary/5 border border-brand-primary/20 p-6 rounded-3xl">
        <View className="flex-row items-center gap-3 mb-3">
          <FontAwesome name="heartbeat" size={16} color="var(--color-primary)" />
          <Text className="text-typography-main font-black text-sm">Your Current Session</Text>
        </View>
        <Text className="text-typography-muted text-xs leading-5">
          Captures a real-time snapshot of your daily points, monthly points, active session time, and flap rate at the moment of generation.
        </Text>
      </View>
    );
  }

  if (type === 'projects') {
    const selectedIds: string[] = params.project_ids || [];
    const dateScoped = !!params.date_scoped;
    return (
      <View className="mb-8">
        <View className="flex-row items-center mb-4">
          <Text className="text-typography-main text-xs font-semibold uppercase tracking-wide flex-1">Projects</Text>
          <Text className="text-typography-muted text-[10px]">
            {selectedIds.length === 0 ? 'All projects (leave empty)' : `${selectedIds.length} selected`}
          </Text>
        </View>
        {projects.length === 0 ? (
          <Text className="text-typography-muted text-xs italic">No projects yet for this company.</Text>
        ) : (
          <View className="flex-row flex-wrap gap-2">
            {projects.map(p => {
              const active = selectedIds.includes(p.id);
              return (
                <TouchableOpacity
                  key={p.id}
                  onPress={() => setParam('project_ids', active ? selectedIds.filter((x: string) => x !== p.id) : [...selectedIds, p.id])}
                  className={`px-4 py-2.5 rounded-xl border transition-all ${active ? 'bg-brand-primary border-brand-primary' : 'bg-surface-background border-surface-border'}`}
                >
                  <Text className={`text-[11px] font-semibold ${active ? 'text-white' : 'text-typography-main'}`}>
                    {p.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
        <Text className="text-typography-muted text-[10px] mt-3 leading-4">
          Snapshot of lifetime project stats by default. Leave empty to include every project.
        </Text>

        <View className="mt-6 flex-row items-center gap-3">
          <TouchableOpacity
            onPress={() => setParam('date_scoped', !dateScoped)}
            className={`w-10 h-6 rounded-full p-0.5 ${dateScoped ? 'bg-brand-primary' : 'bg-surface-border'}`}
          >
            <View className={`h-5 w-5 rounded-full bg-white ${dateScoped ? 'ml-auto' : ''}`} />
          </TouchableOpacity>
          <View className="flex-1">
            <Text className="text-typography-main text-xs font-bold">Scope task throughput to a date range</Text>
            <Text className="text-typography-muted text-[10px] leading-4">
              When on, the projected ETA is computed using completion rate inside the shared date range above.
            </Text>
          </View>
        </View>
      </View>
    );
  }

  return null;
}

// ── SeriesControls ─────────────────────────────────────────────────────────────

function SeriesControls({ periodType, nPeriods, onPeriodType, onNPeriods }: {
  periodType: string;
  nPeriods: string;
  onPeriodType: (v: string) => void;
  onNPeriods: (v: string) => void;
}) {
  return (
    <>
      <Text className="text-typography-muted text-[10px] font-bold uppercase mb-3 ml-1">Period Granularity</Text>
      <View className="flex-row gap-4 mb-6">
        {(['week', 'month', 'year'] as const).map(p => (
          <TouchableOpacity
            key={p}
            onPress={() => onPeriodType(p)}
            className={`flex-1 py-5 rounded-2xl border items-center transition-all ${periodType === p ? 'border-brand-primary bg-brand-primary' : 'border-surface-border bg-surface-background/40'}`}
          >
            <Text className={`font-semibold capitalize tracking-wide ${periodType === p ? 'text-white' : 'text-typography-main'}`}>{p}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text className="text-typography-muted text-[10px] font-semibold uppercase mb-2 ml-1">Number of Periods</Text>
      <RNTextInput
        value={nPeriods}
        onChangeText={onNPeriods}
        keyboardType="numeric"
        placeholder="12"
        className="border border-surface-border bg-surface-background rounded-2xl p-5 text-typography-main font-bold mb-8"
        placeholderTextColor="rgb(var(--text-muted))"
      />
    </>
  );
}

// ── ParameterSection ───────────────────────────────────────────────────────────

function ParameterSection({ title, options, value, onSelect, placeholder, labelKey = 'name', required = false }: any) {
  return (
    <View className="mb-8">
      <View className="flex-row items-center mb-4">
        <Text className="text-typography-main text-xs font-semibold uppercase tracking-wide flex-1">{title}</Text>
        {required && <Text className="text-state-danger text-[9px] font-semibold uppercase tracking-wide">Required</Text>}
      </View>
      <View className="flex-row flex-wrap gap-2">
        {!required && (
          <TouchableOpacity
            onPress={() => onSelect('')}
            className={`px-4 py-2.5 rounded-xl border transition-all ${!value ? 'bg-brand-primary border-brand-primary' : 'bg-surface-background border-surface-border hover:bg-surface-overlay'}`}
          >
            <Text className={`text-[11px] font-semibold ${!value ? 'text-white' : 'text-typography-muted'}`}>{placeholder}</Text>
          </TouchableOpacity>
        )}
        {options.map((opt: any) => (
          <TouchableOpacity
            key={opt.id}
            onPress={() => onSelect(opt.id)}
            className={`px-4 py-2.5 rounded-xl border transition-all ${value === opt.id ? 'bg-brand-primary border-brand-primary' : 'bg-surface-background border-surface-border hover:bg-surface-overlay'}`}
          >
            <Text className={`text-[11px] font-semibold ${value === opt.id ? 'text-white' : 'text-typography-main'}`}>{opt[labelKey]}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}
