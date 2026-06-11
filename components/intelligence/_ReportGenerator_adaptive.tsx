import HorizontalScroll from '@/components/common/HorizontalScroll';
import PremiumCalendarPicker from '@/components/common/PremiumCalendarPicker';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { supabase } from '@/lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  Modal,
  Pressable,
  TextInput as RNTextInput,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { generateAndUploadReport } from './reports/generate';

const BRAND_DIM = 'rgba(99,102,241,0.15)';

function fmt(s: number) {
  return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`;
}

function GenerationProgress({ current, total, elapsed }: { current: number; total: number; elapsed: number }) {
  const colors = useThemeColors();
  const size = 110;
  const stroke = 8;
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const pct = total > 0 ? current / total : 0;
  const eta = current > 1 && elapsed > 1 ? Math.round((elapsed / current) * (total - current)) : null;

  return (
    <View style={{ alignItems: 'center', gap: 4 }}>
      <View style={{ width: size, height: size }}>
        <Svg width={size} height={size}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={BRAND_DIM} strokeWidth={stroke} fill="none" />
          <Circle
            cx={size / 2} cy={size / 2} r={r}
            stroke={colors.primary} strokeWidth={stroke} fill="none"
            strokeDasharray={circ} strokeDashoffset={circ * (1 - pct)}
            strokeLinecap="round" rotation="-90" origin={`${size / 2}, ${size / 2}`}
          />
        </Svg>
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: 'white', fontWeight: '900', fontSize: 18, fontVariant: ['tabular-nums'] }}>
            {current}/{total}
          </Text>
          <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 10, marginTop: 2 }}>reports</Text>
        </View>
      </View>
      <Text style={{ color: 'rgba(255,255,255,0.65)', fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
        {fmt(elapsed)}
      </Text>
      {eta !== null && eta > 0 ? (
        <Text style={{ color: 'rgba(255,255,255,0.35)', fontSize: 10 }}>~{fmt(eta)} remaining</Text>
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

const REPORT_TYPES: { value: ReportType; label: string; desc: string; icon: string; group: 'legacy' | 'analytics' }[] = [
  { value: 'general',                  label: 'Performance Audit',             desc: 'Org or pipeline metrics',                        icon: 'bar-chart',     group: 'legacy'    },
  { value: 'worker_comparison',         label: 'Personnel Benchmarking',        desc: 'Head-to-head (2) or group table (3+), empty = all', icon: 'users',         group: 'legacy'    },
  { value: 'team_comparison',           label: 'Team Matrix Analysis',          desc: 'Head-to-head (2) or group table (3+), empty = all', icon: 'group',         group: 'legacy'    },
  { value: 'workflow_analysis',         label: 'Pipeline Review',         desc: 'Stage-by-stage delay deep-dive',                 icon: 'rocket',        group: 'legacy'    },
  { value: 'user_performance_series',   label: 'Performance Timeline',    desc: 'Period-by-period output and efficiency',         icon: 'line-chart',    group: 'analytics' },
  { value: 'user_performance_summary',  label: 'Performance Summary',     desc: 'Aggregated stats over a date range',             icon: 'user',          group: 'analytics' },
  { value: 'pipeline_stage_dwell',      label: 'Stage Dwell Analysis',          desc: 'Avg/median/P75 per stage & bottlenecks',         icon: 'clock-o',       group: 'analytics' },
  { value: 'pipeline_throughput',       label: 'Pipeline Throughput',           desc: 'Success/failure rates by period',                icon: 'area-chart',    group: 'analytics' },
  { value: 'personnel_comparison',      label: 'People Cost Comparison',       desc: 'Cost, points/hour and efficiency comparison',    icon: 'balance-scale', group: 'analytics' },
  { value: 'targets_status',            label: 'Objectives & SLA Report',       desc: 'All active, hit, and expired targets',           icon: 'bullseye',      group: 'analytics' },
  { value: 'personal_pulse',            label: 'Personal Activity Snapshot',    desc: 'Daily/monthly points & session time',            icon: 'heartbeat',     group: 'analytics' },
  { value: 'projects',                  label: 'Projects Status',               desc: 'Completion, throughput, projected ETA',          icon: 'folder-open-o', group: 'analytics' },
];

interface ReportGeneratorProps {
  visible: boolean;
  onClose: () => void;
  onReportGenerated: () => void;
  isPage?: boolean;
}

export default function ReportGenerator({ visible, onClose, onReportGenerated, isPage = false }: ReportGeneratorProps) {
  const colors = useThemeColors();
  const { hasPermission, user, profile } = useAuth();
  const router = useRouter();

  const [selectedTypes, setSelectedTypes] = useState<ReportType[]>(['general']);
  const [typeParams, setTypeParams]       = useState<Record<string, Record<string, any>>>({});

  // Shared temporal
  const [timeFrame, setTimeFrame]         = useState<'7' | '30' | '90' | 'custom'>('30');
  const [dateStart, setDateStart]         = useState('');
  const [dateEnd, setDateEnd]             = useState('');
  const [activeDateField, setActiveDateField] = useState<'start' | 'end'>('start');

  const [pipelines, setPipelines] = useState<any[]>([]);
  const [teams, setTeams]         = useState<any[]>([]);
  const [workers, setWorkers]     = useState<any[]>([]);
  const [projects, setProjects]   = useState<any[]>([]);
  const [loading, setLoading]         = useState(false);
  const [genError, setGenError]       = useState<string | null>(null);
  const [genProgress, setGenProgress] = useState<{ current: number; total: number } | null>(null);
  const [elapsed, setElapsed]         = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (visible || isPage) loadFilterOptions();
  }, [visible]);

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
        ? prev.length > 1 ? prev.filter(t => t !== type) : prev
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
      params.days = days;
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
        params.user_ids = tp.user_ids  || [];
        params.salaries = tp.salaries  || {};
        break;
      case 'projects':
        params.project_ids = tp.project_ids || [];
        break;
    }
    return params;
  };

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
        const taggedParams = { ...parameters, _generated_from: isPage ? 'mobile' : 'mobile_modal' };
        const { data: jobId, error } = await supabase.rpc('rpc_request_report', {
          p_report_type: reportType,
          p_parameters:  taggedParams,
        });
        if (error) throw error;
        if (!jobId) throw new Error('Failed to create report job');
        createdJobIds.push(jobId);
        await generateAndUploadReport(jobId, reportType, taggedParams, supabase, user.id, profile.company_id);
      }

      // Post-loop verification: confirm every row landed in 'completed' before navigating away
      const { data: verifyRows } = await supabase
        .from('reporting_jobs')
        .select('id, status')
        .in('id', createdJobIds);
      const incomplete = (verifyRows || []).filter(r => r.status !== 'completed');
      if (incomplete.length > 0) {
        setGenError(`${incomplete.length} of ${createdJobIds.length} report(s) didn't reach completed status. Check the Reports list.`);
        return;
      }

      if (isPage) {
        router.replace('/intelligence/reports');
      } else {
        onReportGenerated();
        onClose();
      }
    } catch (error: any) {
      console.error('Report generation error:', error);
      setGenError(error.message || 'Failed to generate report');
    } finally {
      if (timerRef.current) clearInterval(timerRef.current);
      setLoading(false);
      setGenProgress(null);
    }
  };

  const isMulti = selectedTypes.length > 1;

  const content = (
    <View className={isPage ? 'flex-1 bg-surface-background' : 'w-full max-w-2xl h-[90%] bg-surface-background rounded-[32px] border border-surface-border overflow-hidden premium-shadow glass-card'}>

      {/* Header */}
      <View className={`px-6 py-5 border-b border-surface-border flex-row items-center justify-between ${isPage ? 'bg-surface-card' : 'bg-surface-card/50'}`}>
        <View className="flex-row items-center min-w-0">
          <View className="h-10 w-1 rounded-full bg-brand-primary mr-4" />
          <View>
            <Text className="text-lg font-black uppercase tracking-widest text-typography-main">Report Architect</Text>
            <Text className="text-[10px] font-bold text-brand-primary uppercase tracking-tighter">
              {isMulti ? `${selectedTypes.length} Reports Combined` : 'Intelligence Engine'}
            </Text>
          </View>
        </View>
        {!isPage && (
          <Pressable onPress={onClose} className="h-10 w-10 items-center justify-center rounded-full bg-surface-background border border-surface-border active:scale-90">
            <FontAwesome name="close" size={16} color={colors.primary} />
          </Pressable>
        )}
      </View>

      <ScrollView className="flex-1 p-6" showsVerticalScrollIndicator={false}>
        {pipelines.length === 0 ? (
          <View className="py-10">
            <View className="bg-surface-card p-8 rounded-[2rem] border border-surface-border items-center">
              <View className="w-16 h-16 bg-brand-primary/10 rounded-full items-center justify-center mb-6">
                <FontAwesome name="file-text-o" size={24} color={colors.primary} />
              </View>
              {hasPermission('pipeline.edit') ? (
                <>
                  <Text className="text-typography-main text-2xl font-black mb-2 text-center">Setup Required</Text>
                  <Text className="text-typography-muted text-center mb-8 leading-relaxed text-sm">No pipelines detected.</Text>
                </>
              ) : (
                <View className="bg-state-info-dim border border-state-info/20 p-6 rounded-2xl w-full">
                  <Text className="text-typography-main text-base font-black mb-1">Access Restricted</Text>
                  <Text className="text-typography-muted text-xs font-bold leading-relaxed">Contact company Admin.</Text>
                </View>
              )}
            </View>
          </View>
        ) : (
          <>
            {genError && (
              <View className="bg-state-danger/10 border border-state-danger/30 rounded-2xl px-5 py-4 mb-5 flex-row items-center gap-3">
                <FontAwesome name="exclamation-circle" size={16} color={colors.danger} />
                <Text className="text-state-danger font-bold flex-1 text-sm">{genError}</Text>
                <TouchableOpacity onPress={() => setGenError(null)}>
                  <FontAwesome name="times" size={14} color={colors.danger} />
                </TouchableOpacity>
              </View>
            )}

            {/* ── Type Selector (multi-select) ── */}
            <View className="mb-6">
              <View className="flex-row items-center justify-between mb-3">
                <Text className="text-[10px] font-black uppercase tracking-[0.2em] text-typography-muted">Standard Reports</Text>
                {isMulti && (
                  <View className="bg-brand-primary/10 border border-brand-primary/20 px-2.5 py-1 rounded-full">
                    <Text className="text-brand-primary text-[8px] font-black uppercase tracking-widest">{selectedTypes.length} selected</Text>
                  </View>
                )}
              </View>
              {REPORT_TYPES.filter(t => t.group === 'legacy').map(opt => (
                <TypeCard key={opt.value} opt={opt} selected={selectedTypes.includes(opt.value)} onPress={() => toggleType(opt.value)} />
              ))}
              
              <View className="flex-row items-center gap-3 mt-5 mb-3">
                <Text className="text-[10px] font-black uppercase tracking-[0.2em] text-typography-muted">Analytics Engine</Text>
                <View className="bg-brand-primary/10 px-2 py-0.5 rounded-full">
                  <Text className="text-brand-primary text-[8px] font-black uppercase tracking-widest">New</Text>
                </View>
              </View>
              {REPORT_TYPES.filter(t => t.group === 'analytics').map(opt => (
                <TypeCard key={opt.value} opt={opt} selected={selectedTypes.includes(opt.value)} onPress={() => toggleType(opt.value)} />
              ))}
            </View>

            <View className="h-px bg-surface-border mb-6" />

            {/* ── Shared Temporal Scope ── */}
            {needsDateRange && (
              <>
                <View className="mb-6">
                  <Text className="text-[10px] font-black uppercase tracking-[0.2em] text-typography-muted mb-3">Temporal Scope</Text>
                  <View className="flex-row gap-2 mb-3">
                    {(['7', '30', '90'] as const).map(d => (
                      <Pressable key={d} onPress={() => setTimeFrame(d)} className={`flex-1 py-3 rounded-xl border items-center ${timeFrame === d ? 'border-brand-primary bg-brand-primary' : 'border-surface-border bg-surface-card'}`}>
                        <Text className={`font-bold ${timeFrame === d ? 'text-white' : 'text-typography-main'}`}>{d}D</Text>
                      </Pressable>
                    ))}
                    <Pressable onPress={() => setTimeFrame('custom')} className={`flex-1 py-3 rounded-xl border items-center ${timeFrame === 'custom' ? 'border-brand-primary bg-brand-primary' : 'border-surface-border bg-surface-card'}`}>
                      <Text className={`font-bold ${timeFrame === 'custom' ? 'text-white' : 'text-typography-main'}`}>Custom</Text>
                    </Pressable>
                  </View>
                  {timeFrame === 'custom' && (
                    <View className="gap-3">
                      <View className="flex-row gap-2">
                        <TouchableOpacity
                          onPress={() => setActiveDateField('start')}
                          className={`flex-1 py-4 px-4 rounded-2xl border ${activeDateField === 'start' ? 'bg-brand-primary/10 border-brand-primary' : 'border-surface-border bg-surface-card'}`}
                        >
                          <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest text-center">From</Text>
                          <Text className={`text-center font-black text-sm mt-1 ${activeDateField === 'start' ? 'text-brand-primary' : 'text-typography-main'}`} numberOfLines={1}>
                            {dateStart || 'Select'}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => setActiveDateField('end')}
                          className={`flex-1 py-4 px-4 rounded-2xl border ${activeDateField === 'end' ? 'bg-brand-primary/10 border-brand-primary' : 'border-surface-border bg-surface-card'}`}
                        >
                          <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest text-center">To</Text>
                          <Text className={`text-center font-black text-sm mt-1 ${activeDateField === 'end' ? 'text-brand-primary' : 'text-typography-main'}`} numberOfLines={1}>
                            {dateEnd || 'Select'}
                          </Text>
                        </TouchableOpacity>
                      </View>
                      <PremiumCalendarPicker
                        compact
                        selectedDate={activeDateField === 'start' ? dateStart : dateEnd}
                        onSelect={(date) => {
                          if (activeDateField === 'start') {
                            setDateStart(date);
                            if (!dateEnd) setActiveDateField('end');
                          } else {
                            setDateEnd(date);
                          }
                        }}
                      />
                    </View>
                  )}
                </View>
                <View className="h-px bg-surface-border mb-6" />
              </>
            )}

            {/* ── Per-type Parameters ── */}
            {selectedTypes.map((type, idx) => {
              const meta = REPORT_TYPES.find(r => r.value === type)!;
              return (
                <View key={type} className={idx > 0 ? 'mt-6 pt-6 border-t border-surface-border' : ''}>
                  {isMulti && (
                    <View className="flex-row items-center gap-2 mb-4">
                      <View className="w-5 h-5 bg-brand-primary rounded-md items-center justify-center">
                        <FontAwesome name={meta.icon as any} size={9} color="white" />
                      </View>
                      <Text className="text-[10px] font-black uppercase tracking-[0.15em] text-brand-primary">{meta.label}</Text>
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
          </>
        )}
        <View className="h-12" />
      </ScrollView>

      {/* Leave warning */}
      {loading && (
        <View className="mx-6 mb-0 mt-2 bg-state-warning/10 border border-state-warning/30 rounded-2xl px-5 py-3 flex-row items-center gap-3">
          <FontAwesome name="warning" size={13} color={colors.warning} />
          <Text className="text-state-warning font-semibold text-xs flex-1">
            Don't close this — reports are being generated. Leaving will cancel the remaining jobs.
          </Text>
        </View>
      )}

      {/* Footer */}
      <View className={`px-6 py-6 border-t border-surface-border ${isPage ? 'bg-surface-card pb-12' : 'bg-surface-card/50'} ${loading && genProgress ? 'items-center' : 'flex-row flex-wrap gap-4'}`}>
        {loading && genProgress ? (
          <GenerationProgress current={genProgress.current} total={genProgress.total} elapsed={elapsed} />
        ) : (
          <>
            {!isPage && (
              <Pressable onPress={onClose} disabled={loading} className="flex-1 min-w-[120px] py-4 rounded-2xl border border-surface-border bg-surface-background items-center">
                <Text className="text-typography-muted font-bold">Discard</Text>
              </Pressable>
            )}
            <Pressable
              onPress={handleGenerateReport}
              disabled={loading || pipelines.length === 0}
              className={`${isPage ? 'flex-1' : 'flex-[1.5]'} min-w-[160px] py-4 rounded-2xl items-center ${pipelines.length === 0 ? 'bg-surface-border' : 'bg-brand-primary active:scale-95 shadow-lg shadow-brand-primary/20'}`}
            >
              <View className="flex-row items-center">
                <FontAwesome name="bolt" size={14} color="white" style={{ marginRight: 8 }} />
                <Text className="text-white font-black uppercase tracking-widest text-xs">
                  {isMulti ? `Execute ${selectedTypes.length} Reports` : 'Execute Generation'}
                </Text>
              </View>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );

  if (isPage) return content;

  return (
    <Modal visible={visible} animationType="slide" transparent={true}>
      <View className="flex-1 justify-center items-center bg-black/40 p-4 lg:p-10">
        {content}
      </View>
    </Modal>
  );
}

// ── TypeCard ──────────────────────────────────────────────────────────────────

function TypeCard({ opt, selected, onPress }: { opt: typeof REPORT_TYPES[number]; selected: boolean; onPress: () => void }) {
  const colors = useThemeColors();
  return (
    <Pressable onPress={onPress} className={`p-4 mb-3 rounded-2xl border flex-row items-center ${selected ? 'border-brand-primary bg-brand-primary/10' : 'border-surface-border bg-surface-card active:bg-surface-overlay'}`}>
      <View className={`h-10 w-10 items-center justify-center rounded-xl ${selected ? 'bg-brand-primary' : 'bg-surface-background'}`}>
        <FontAwesome name={opt.icon as any} size={16} color={selected ? 'white' : 'rgb(var(--brand-accent) / 0.5)'} />
      </View>
      <View className="ml-4 flex-1">
        <Text className={`font-bold ${selected ? 'text-brand-primary' : 'text-typography-main'}`}>{opt.label}</Text>
        <Text className="text-xs text-typography-muted mt-0.5" numberOfLines={1}>{opt.desc}</Text>
      </View>
      {/* Checkbox indicator */}
      <View className={`h-7 w-7 rounded-full border-2 items-center justify-center ${selected ? 'bg-brand-primary border-brand-primary' : 'border-surface-border'}`}>
        {selected && <FontAwesome name="check" size={10} color="white" />}
      </View>
    </Pressable>
  );
}

// ── TypeParamPanel ─────────────────────────────────────────────────────────────

function TypeParamPanel({ type, params, setParam, toggleMultiUser, pipelines, teams, workers, projects }: {
  type: ReportType;
  params: Record<string, any>;
  setParam: (key: string, value: any) => void;
  toggleMultiUser: (uid: string) => void;
  pipelines: any[];
  teams: any[];
  workers: any[];
  projects: any[];
}) {
  const colors = useThemeColors();
  if (type === 'general' || type === 'workflow_analysis') {
    return (
      <>
        <ChipRow label="Pipeline" options={pipelines} value={params.pipeline_id || ''} onSelect={v => setParam('pipeline_id', v)} placeholder="All Pipelines" />
        <ChipRow label="Team"     options={teams}     value={params.team_id     || ''} onSelect={v => setParam('team_id', v)}     placeholder="All Teams" />
        <ChipRow label="Person"   options={workers}   value={params.worker_id   || ''} onSelect={v => setParam('worker_id', v)}   placeholder="All People" labelKey="full_name" />
        <ChipRow label="Priority"
          options={[{id:'low',name:'Low'},{id:'medium',name:'Medium'},{id:'high',name:'High'},{id:'critical',name:'Critical'}]}
          value={params.priority || ''} onSelect={v => setParam('priority', v)} placeholder="All"
        />
      </>
    );
  }

  if (type === 'worker_comparison') {
    const selectedIds: string[] = params.user_ids || [];
    return (
      <View className="mb-4">
        <View className="flex-row items-center mb-3">
          <Text className="text-[10px] font-black uppercase tracking-[0.2em] text-typography-muted flex-1">Workers</Text>
          <Text className="text-typography-muted text-[10px]">
            {selectedIds.length === 0 ? 'All people' : `${selectedIds.length} selected`}
          </Text>
        </View>
        <HorizontalScroll>
          {workers.map(w => {
            const active = selectedIds.includes(w.id);
            return (
              <Pressable key={w.id} onPress={() => toggleMultiUser(w.id)} className={`px-4 py-2 mr-2 rounded-xl border ${active ? 'border-brand-primary bg-brand-primary/20' : 'border-surface-border bg-surface-card'}`}>
                <Text className={`text-xs font-bold ${active ? 'text-brand-primary' : 'text-typography-muted'}`}>{w.full_name}</Text>
              </Pressable>
            );
          })}
        </HorizontalScroll>
        <Text className="text-typography-muted text-[9px] mt-2 leading-4">
          Select 2 for head-to-head, 3+ for a group table, or leave empty to compare all personnel.
        </Text>
      </View>
    );
  }

  if (type === 'team_comparison') {
    const selectedIds: string[] = params.team_ids || [];
    return (
      <View className="mb-4">
        <View className="flex-row items-center mb-3">
          <Text className="text-[10px] font-black uppercase tracking-[0.2em] text-typography-muted flex-1">Teams</Text>
          <Text className="text-typography-muted text-[10px]">
            {selectedIds.length === 0 ? 'All teams' : `${selectedIds.length} selected`}
          </Text>
        </View>
        <HorizontalScroll>
          {teams.map(t => {
            const active = selectedIds.includes(t.id);
            return (
              <Pressable key={t.id} onPress={() => setParam('team_ids', active ? selectedIds.filter(x => x !== t.id) : [...selectedIds, t.id])} className={`px-4 py-2 mr-2 rounded-xl border ${active ? 'border-brand-primary bg-brand-primary/20' : 'border-surface-border bg-surface-card'}`}>
                <Text className={`text-xs font-bold ${active ? 'text-brand-primary' : 'text-typography-muted'}`}>{t.name}</Text>
              </Pressable>
            );
          })}
        </HorizontalScroll>
        <Text className="text-typography-muted text-[9px] mt-2 leading-4">
          Select 2 for head-to-head, 3+ for a group table, or leave empty to compare all teams.
        </Text>
      </View>
    );
  }

  if (type === 'user_performance_series' || type === 'user_performance_summary') {
    return (
      <>
        <ChipRow label="Person" options={workers} value={params.user_id || ''} onSelect={v => setParam('user_id', v)} labelKey="full_name" />
        {type === 'user_performance_series' && (
          <>
            <Text className="text-[10px] font-black uppercase tracking-[0.2em] text-typography-muted mb-2 mt-2">Period Granularity</Text>
            <View className="flex-row gap-2 mb-4">
              {(['week', 'month', 'year'] as const).map(p => (
                <Pressable key={p} onPress={() => setParam('period_type', p)} className={`flex-1 py-3 rounded-xl border items-center ${(params.period_type || 'month') === p ? 'border-brand-primary bg-brand-primary' : 'border-surface-border bg-surface-card'}`}>
                  <Text className={`font-bold capitalize text-xs ${(params.period_type || 'month') === p ? 'text-white' : 'text-typography-main'}`}>{p}</Text>
                </Pressable>
              ))}
            </View>
            <Text className="text-[10px] font-black uppercase tracking-[0.2em] text-typography-muted mb-2">Periods</Text>
            <RNTextInput value={params.n_periods || '12'} onChangeText={v => setParam('n_periods', v)} keyboardType="numeric" placeholder="12" className="border border-surface-border bg-surface-card rounded-xl p-4 text-typography-main mb-4" placeholderTextColor={colors.textMuted} />
          </>
        )}
      </>
    );
  }

  if (type === 'pipeline_stage_dwell') {
    return <ChipRow label="Pipeline" options={pipelines} value={params.pipeline_id || ''} onSelect={v => setParam('pipeline_id', v)} />;
  }

  if (type === 'pipeline_throughput') {
    return (
      <>
        <ChipRow label="Pipeline" options={pipelines} value={params.pipeline_id || ''} onSelect={v => setParam('pipeline_id', v)} />
        <Text className="text-[10px] font-black uppercase tracking-[0.2em] text-typography-muted mb-2 mt-2">Period Granularity</Text>
        <View className="flex-row gap-2 mb-4">
          {(['week', 'month', 'year'] as const).map(p => (
            <Pressable key={p} onPress={() => setParam('period_type', p)} className={`flex-1 py-3 rounded-xl border items-center ${(params.period_type || 'month') === p ? 'border-brand-primary bg-brand-primary' : 'border-surface-border bg-surface-card'}`}>
              <Text className={`font-bold capitalize text-xs ${(params.period_type || 'month') === p ? 'text-white' : 'text-typography-main'}`}>{p}</Text>
            </Pressable>
          ))}
        </View>
        <Text className="text-[10px] font-black uppercase tracking-[0.2em] text-typography-muted mb-2">Periods</Text>
        <RNTextInput value={params.n_periods || '12'} onChangeText={v => setParam('n_periods', v)} keyboardType="numeric" placeholder="12" className="border border-surface-border bg-surface-card rounded-xl p-4 text-typography-main mb-4" placeholderTextColor={colors.textMuted} />
      </>
    );
  }

  if (type === 'personnel_comparison') {
    const selectedIds: string[] = params.user_ids || [];
    const salaries: Record<string, number> = params.salaries || {};
    return (
      <View className="mb-4">
        <View className="flex-row items-center mb-3">
          <Text className="text-[10px] font-black uppercase tracking-[0.2em] text-typography-muted flex-1">Workers</Text>
          <Text className="text-typography-muted text-[10px]">{selectedIds.length} selected</Text>
        </View>
        <HorizontalScroll>
          {workers.map(w => {
            const active = selectedIds.includes(w.id);
            return (
              <Pressable key={w.id} onPress={() => toggleMultiUser(w.id)} className={`px-4 py-2 mr-2 rounded-xl border ${active ? 'border-brand-primary bg-brand-primary/20' : 'border-surface-border bg-surface-card'}`}>
                <Text className={`text-xs font-bold ${active ? 'text-brand-primary' : 'text-typography-muted'}`}>{w.full_name}</Text>
              </Pressable>
            );
          })}
        </HorizontalScroll>
        {selectedIds.length > 0 && (
          <View className="mt-4 gap-2">
            <Text className="text-[10px] font-black uppercase tracking-[0.2em] text-typography-muted mb-1">Daily Rate (USD) — Optional</Text>
            {selectedIds.map(uid => {
              const w = workers.find(x => x.id === uid);
              if (!w) return null;
              return (
                <View key={uid} className="flex-row items-center gap-3">
                  <Text className="text-typography-muted text-xs font-bold flex-1" numberOfLines={1}>{w.full_name}</Text>
                  <RNTextInput
                    value={salaries[uid]?.toString() ?? ''}
                    onChangeText={v => setParam('salaries', { ...salaries, [uid]: parseFloat(v) || 0 })}
                    keyboardType="numeric"
                    placeholder="0.00"
                    className="border border-surface-border bg-surface-card rounded-xl px-3 py-2 text-typography-main text-xs w-24 text-right"
                    placeholderTextColor={colors.textMuted}
                  />
                </View>
              );
            })}
          </View>
        )}
      </View>
    );
  }

  if (type === 'targets_status') {
    return (
      <View className="bg-brand-primary/5 border border-brand-primary/20 p-5 rounded-2xl mb-4">
        <Text className="text-typography-main font-black text-sm mb-2">Company-Wide Scope</Text>
        <Text className="text-typography-muted text-xs leading-5">Includes all active, hit, and expired targets across every pipeline. No extra filters needed.</Text>
      </View>
    );
  }

  if (type === 'personal_pulse') {
    return (
      <View className="bg-brand-primary/5 border border-brand-primary/20 p-5 rounded-2xl mb-4">
        <Text className="text-typography-main font-black text-sm mb-2">Your Current Session</Text>
        <Text className="text-typography-muted text-xs leading-5">Captures your real-time daily/monthly points, active session time, and flap rate at generation time.</Text>
      </View>
    );
  }

  if (type === 'projects') {
    const selectedIds: string[] = params.project_ids || [];
    const dateScoped = !!params.date_scoped;
    return (
      <View className="mb-4">
        <View className="flex-row items-center mb-3">
          <Text className="text-[10px] font-black uppercase tracking-[0.2em] text-typography-muted flex-1">Projects</Text>
          <Text className="text-typography-muted text-[10px]">
            {selectedIds.length === 0 ? 'All projects' : `${selectedIds.length} selected`}
          </Text>
        </View>
        {projects.length === 0 ? (
          <Text className="text-typography-muted text-xs italic">No projects yet.</Text>
        ) : (
          <HorizontalScroll>
            {projects.map(p => {
              const active = selectedIds.includes(p.id);
              return (
                <Pressable
                  key={p.id}
                  onPress={() => setParam('project_ids', active ? selectedIds.filter((x: string) => x !== p.id) : [...selectedIds, p.id])}
                  className={`px-4 py-2 mr-2 rounded-xl border ${active ? 'border-brand-primary bg-brand-primary/20' : 'border-surface-border bg-surface-card'}`}
                >
                  <Text className={`text-xs font-bold ${active ? 'text-brand-primary' : 'text-typography-muted'}`}>{p.name}</Text>
                </Pressable>
              );
            })}
          </HorizontalScroll>
        )}
        <Text className="text-typography-muted text-[9px] mt-2 leading-4">
          Snapshot of lifetime stats. Leave empty to include all projects.
        </Text>

        <Pressable
          onPress={() => setParam('date_scoped', !dateScoped)}
          className="mt-4 flex-row items-center gap-3"
        >
          <View className={`w-10 h-6 rounded-full p-0.5 ${dateScoped ? 'bg-brand-primary' : 'bg-surface-border'}`}>
            <View className={`h-5 w-5 rounded-full bg-white ${dateScoped ? 'ml-auto' : ''}`} />
          </View>
          <Text className="text-typography-main text-xs font-bold flex-1">Scope rate to date range</Text>
        </Pressable>
      </View>
    );
  }

  return null;
}

// ── ChipRow ───────────────────────────────────────────────────────────────────

function ChipRow({ label, options, value, onSelect, placeholder, labelKey = 'name' }: any) {
  const colors = useThemeColors();
  return (
    <View className="mb-4">
      <Text className="text-[10px] font-black uppercase tracking-[0.2em] text-typography-muted mb-2">{label}</Text>
      <HorizontalScroll>
        {placeholder && (
          <Pressable onPress={() => onSelect('')} className={`px-4 py-2 mr-2 rounded-xl border ${!value ? 'border-brand-primary bg-brand-primary' : 'border-surface-border bg-surface-card'}`}>
            <Text className={`text-xs font-bold ${!value ? 'text-white' : 'text-typography-main'}`}>{placeholder}</Text>
          </Pressable>
        )}
        {options.map((opt: any) => (
          <Pressable key={opt.id} onPress={() => onSelect(opt.id)} className={`px-4 py-2 mr-2 rounded-xl border ${value === opt.id ? 'border-brand-primary bg-brand-primary' : 'border-surface-border bg-surface-card'}`}>
            <Text className={`text-xs font-bold ${value === opt.id ? 'text-white' : 'text-typography-muted'}`}>{opt[labelKey]}</Text>
          </Pressable>
        ))}
      </HorizontalScroll>
    </View>
  );
}
