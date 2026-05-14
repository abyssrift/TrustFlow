import HorizontalScroll from '@/components/common/HorizontalScroll';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Modal,
    Pressable,
    TextInput as RNTextInput,
    ScrollView,
    Text,
    View,
} from 'react-native';

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

const REPORT_TYPES: { value: ReportType; label: string; desc: string; icon: string; group: 'legacy' | 'analytics' }[] = [
  { value: 'general',                  label: 'Performance Audit',             desc: 'Org or pipeline metrics',                        icon: 'bar-chart',     group: 'legacy'    },
  { value: 'worker_comparison',         label: 'Personnel Benchmarking',        desc: 'Delta between two workers',                      icon: 'users',         group: 'legacy'    },
  { value: 'team_comparison',           label: 'Team Matrix Analysis',          desc: 'Efficiency across two teams',                    icon: 'group',         group: 'legacy'    },
  { value: 'workflow_analysis',         label: 'Pipeline Bottleneck Scan',      desc: 'Stage-by-stage delay deep-dive',                 icon: 'rocket',        group: 'legacy'    },
  { value: 'user_performance_series',   label: 'Worker Timeline',               desc: 'Period-by-period output & efficiency',           icon: 'line-chart',    group: 'analytics' },
  { value: 'user_performance_summary',  label: 'Worker Summary',                desc: 'Aggregated stats over a date range',             icon: 'user',          group: 'analytics' },
  { value: 'pipeline_stage_dwell',      label: 'Stage Dwell Analysis',          desc: 'Avg/median/P75 per stage & bottlenecks',         icon: 'clock-o',       group: 'analytics' },
  { value: 'pipeline_throughput',       label: 'Pipeline Throughput',           desc: 'Success/failure rates by period',                icon: 'area-chart',    group: 'analytics' },
  { value: 'personnel_comparison',      label: 'Multi-Personnel Comparison',    desc: 'Cost, points/hour & efficiency comparison',      icon: 'balance-scale', group: 'analytics' },
  { value: 'targets_status',            label: 'Objectives & SLA Report',       desc: 'All active, hit, and expired targets',           icon: 'bullseye',      group: 'analytics' },
  { value: 'personal_pulse',            label: 'Personal Activity Snapshot',    desc: 'Daily/monthly points & session time',            icon: 'heartbeat',     group: 'analytics' },
];

interface ReportGeneratorProps {
  visible: boolean;
  onClose: () => void;
  onReportGenerated: () => void;
  isPage?: boolean;
}

export default function ReportGenerator({ visible, onClose, onReportGenerated, isPage = false }: ReportGeneratorProps) {
  const { hasPermission } = useAuth();
  const router = useRouter();

  const [reportType, setReportType]           = useState<ReportType>('general');
  const [timeFrame, setTimeFrame]             = useState<'7' | '30' | '90' | 'custom'>('30');
  const [dateStart, setDateStart]             = useState('');
  const [dateEnd, setDateEnd]                 = useState('');
  const [pipelineId, setPipelineId]           = useState('');
  const [teamId, setTeamId]                   = useState('');
  const [workerId, setWorkerId]               = useState('');
  const [priorityFilter, setPriorityFilter]   = useState('');
  const [workerA_id, setWorkerA_id]           = useState('');
  const [workerB_id, setWorkerB_id]           = useState('');
  const [teamA_id, setTeamA_id]               = useState('');
  const [teamB_id, setTeamB_id]               = useState('');
  const [singleUserId, setSingleUserId]       = useState('');
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [salaries, setSalaries]               = useState<Record<string, number>>({});
  const [periodType, setPeriodType]           = useState<'week' | 'month' | 'year'>('month');
  const [nPeriods, setNPeriods]               = useState('12');

  const [pipelines, setPipelines] = useState<any[]>([]);
  const [teams, setTeams]         = useState<any[]>([]);
  const [workers, setWorkers]     = useState<any[]>([]);
  const [loading, setLoading]     = useState(false);

  useEffect(() => {
    if (visible) loadFilterOptions();
  }, [visible]);

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
    setSelectedUserIds(prev => prev.includes(uid) ? prev.filter(x => x !== uid) : [...prev, uid]);
  };

  const handleGenerateReport = async () => {
    try {
      setLoading(true);
      const temporalMode = getTemporalMode(reportType);

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
            Alert.alert('Error', 'Please select both workers');
            return;
          }
          parameters.days = days;
          parameters.worker_a_id = workerA_id;
          parameters.worker_b_id = workerB_id;
          if (dateStartParam) parameters.date_start = dateStartParam;
          if (dateEndParam)   parameters.date_end   = dateEndParam;
          break;
        }
        case 'team_comparison': {
          if (!teamA_id || !teamB_id) {
            Alert.alert('Error', 'Please select both teams');
            return;
          }
          parameters.days = days;
          parameters.team_a_id = teamA_id;
          parameters.team_b_id = teamB_id;
          if (dateStartParam) parameters.date_start = dateStartParam;
          if (dateEndParam)   parameters.date_end   = dateEndParam;
          break;
        }
        case 'user_performance_series': {
          if (!singleUserId) { Alert.alert('Error', 'Please select a worker'); return; }
          parameters.user_id     = singleUserId;
          parameters.period_type = periodType;
          parameters.n_periods   = parseInt(nPeriods) || 12;
          break;
        }
        case 'user_performance_summary': {
          if (!singleUserId) { Alert.alert('Error', 'Please select a worker'); return; }
          parameters.user_id    = singleUserId;
          parameters.date_start = dateStartParam;
          parameters.date_end   = dateEndParam;
          break;
        }
        case 'pipeline_stage_dwell': {
          if (!pipelineId) { Alert.alert('Error', 'Please select a pipeline'); return; }
          parameters.pipeline_id = pipelineId;
          parameters.date_start  = dateStartParam;
          parameters.date_end    = dateEndParam;
          break;
        }
        case 'pipeline_throughput': {
          if (!pipelineId) { Alert.alert('Error', 'Please select a pipeline'); return; }
          parameters.pipeline_id = pipelineId;
          parameters.period_type = periodType;
          parameters.n_periods   = parseInt(nPeriods) || 12;
          break;
        }
        case 'personnel_comparison': {
          if (selectedUserIds.length < 2) { Alert.alert('Error', 'Please select at least 2 workers'); return; }
          parameters.user_ids   = selectedUserIds;
          parameters.date_start = dateStartParam;
          parameters.date_end   = dateEndParam;
          if (Object.keys(salaries).length > 0) parameters.salaries = salaries;
          break;
        }
        case 'targets_status':
        case 'personal_pulse':
          break;
      }

      const { data: jobId, error } = await supabase.rpc('rpc_request_report', {
        p_report_type: reportType,
        p_parameters:  parameters,
      });
      if (error) throw error;

      if (jobId) {
        try {
          await fetch('https://wbvgufqfgbvbinjrdzlg.functions.supabase.co/generate-pdf-report-v8', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ job_id: jobId }),
          });
        } catch (fetchErr) {
          console.warn('Edge function trigger error:', fetchErr);
        }
      }

      Alert.alert('Success', 'Report queued successfully!');
      if (isPage) {
        router.replace('/intelligence/archives');
      } else {
        onReportGenerated();
        onClose();
      }
    } catch (error: any) {
      Alert.alert('Error', error.message || 'Failed to generate report');
    } finally {
      setLoading(false);
    }
  };

  const temporalMode = getTemporalMode(reportType);

  const content = (
    <View className={isPage ? 'flex-1 bg-surface-background' : 'w-full max-w-2xl h-[90%] bg-surface-background rounded-[32px] border border-surface-border overflow-hidden premium-shadow glass-card'}>
      {/* Header */}
      <View className={`px-6 py-5 border-b border-surface-border flex-row flex-wrap items-center justify-between gap-4 ${isPage ? 'bg-surface-card' : 'bg-surface-card/50'}`}>
        <View className="flex-row items-center min-w-0">
          <View className="h-10 w-1 rounded-full bg-brand-primary mr-4" />
          <View>
            <Text className="text-lg font-black uppercase tracking-widest text-typography-main">Report Architect</Text>
            <Text className="text-[10px] font-bold text-brand-primary uppercase tracking-tighter">Intelligence Engine v8.0</Text>
          </View>
        </View>
        {!isPage && (
          <Pressable onPress={onClose} className="h-10 w-10 items-center justify-center rounded-full bg-surface-background border border-surface-border active:scale-90">
            <FontAwesome name="close" size={16} color="rgb(var(--brand-accent))" />
          </Pressable>
        )}
      </View>

      <ScrollView className="flex-1 p-6" showsVerticalScrollIndicator={false}>
        {pipelines.length === 0 ? (
          <View className="py-10">
            <View className="bg-surface-card p-8 rounded-[2rem] border border-surface-border items-center premium-shadow">
              <View className="w-16 h-16 bg-brand-primary/10 rounded-full items-center justify-center mb-6">
                <FontAwesome name="file-text-o" size={24} color="rgb(var(--brand-primary))" />
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
            {/* ── Type Selector ── */}
            <View className="mb-6">
              <Text className="text-[10px] font-black uppercase tracking-[0.2em] text-typography-muted mb-3">Standard Reports</Text>
              {REPORT_TYPES.filter(t => t.group === 'legacy').map(opt => (
                <TypeCard key={opt.value} opt={opt} selected={reportType === opt.value} onPress={() => setReportType(opt.value)} />
              ))}
              <View className="flex-row items-center gap-3 mt-5 mb-3">
                <Text className="text-[10px] font-black uppercase tracking-[0.2em] text-typography-muted">Analytics Engine</Text>
                <View className="bg-brand-primary/10 px-2 py-0.5 rounded-full">
                  <Text className="text-brand-primary text-[8px] font-black uppercase tracking-widest">New</Text>
                </View>
              </View>
              {REPORT_TYPES.filter(t => t.group === 'analytics').map(opt => (
                <TypeCard key={opt.value} opt={opt} selected={reportType === opt.value} onPress={() => setReportType(opt.value)} />
              ))}
            </View>

            <View className="h-px bg-surface-border mb-6" />

            {/* ── Temporal Scope ── */}
            {temporalMode !== 'none' && (
              <>
                <View className="mb-6">
                  <Text className="text-[10px] font-black uppercase tracking-[0.2em] text-typography-muted mb-3">Temporal Scope</Text>
                  {temporalMode === 'range' && (
                    <>
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
                        <View className="gap-2">
                          <RNTextInput placeholder="Start Date (YYYY-MM-DD)" value={dateStart} onChangeText={setDateStart} className="border border-surface-border bg-surface-card rounded-xl p-4 text-typography-main" placeholderTextColor="rgb(var(--text-muted))" />
                          <RNTextInput placeholder="End Date (YYYY-MM-DD)" value={dateEnd} onChangeText={setDateEnd} className="border border-surface-border bg-surface-card rounded-xl p-4 text-typography-main" placeholderTextColor="rgb(var(--text-muted))" />
                        </View>
                      )}
                    </>
                  )}
                  {temporalMode === 'series' && (
                    <>
                      <Text className="text-xs font-bold text-typography-dim mb-2 ml-1">Period Granularity</Text>
                      <View className="flex-row gap-2 mb-4">
                        {(['week', 'month', 'year'] as const).map(p => (
                          <Pressable key={p} onPress={() => setPeriodType(p)} className={`flex-1 py-3 rounded-xl border items-center ${periodType === p ? 'border-brand-primary bg-brand-primary' : 'border-surface-border bg-surface-card'}`}>
                            <Text className={`font-bold capitalize text-xs ${periodType === p ? 'text-white' : 'text-typography-main'}`}>{p}</Text>
                          </Pressable>
                        ))}
                      </View>
                      <Text className="text-xs font-bold text-typography-dim mb-2 ml-1">Number of Periods</Text>
                      <RNTextInput value={nPeriods} onChangeText={setNPeriods} keyboardType="numeric" placeholder="12" className="border border-surface-border bg-surface-card rounded-xl p-4 text-typography-main" placeholderTextColor="rgb(var(--text-muted))" />
                    </>
                  )}
                </View>
                <View className="h-px bg-surface-border mb-6" />
              </>
            )}

            {/* ── Filters ── */}
            {(reportType === 'general' || reportType === 'workflow_analysis') && (
              <>
                <ChipRow label="Pipeline" options={pipelines} value={pipelineId} onSelect={setPipelineId} placeholder="All Pipelines" />
                <ChipRow label="Team" options={teams} value={teamId} onSelect={setTeamId} placeholder="All Teams" />
                <ChipRow label="Worker" options={workers} value={workerId} onSelect={setWorkerId} placeholder="All Personnel" labelKey="full_name" />
                <ChipRow label="Priority" options={[{id:'low',name:'Low'},{id:'medium',name:'Medium'},{id:'high',name:'High'},{id:'critical',name:'Critical'}]} value={priorityFilter} onSelect={setPriorityFilter} placeholder="All" />
              </>
            )}
            {reportType === 'worker_comparison' && (
              <>
                <ChipRow label="Worker Alpha" options={workers} value={workerA_id} onSelect={setWorkerA_id} labelKey="full_name" />
                <ChipRow label="Worker Beta"  options={workers} value={workerB_id} onSelect={setWorkerB_id} labelKey="full_name" />
              </>
            )}
            {reportType === 'team_comparison' && (
              <>
                <ChipRow label="Team Alpha" options={teams} value={teamA_id} onSelect={setTeamA_id} />
                <ChipRow label="Team Beta"  options={teams} value={teamB_id} onSelect={setTeamB_id} />
              </>
            )}
            {(reportType === 'user_performance_series' || reportType === 'user_performance_summary') && (
              <ChipRow label="Worker" options={workers} value={singleUserId} onSelect={setSingleUserId} labelKey="full_name" />
            )}
            {(reportType === 'pipeline_stage_dwell' || reportType === 'pipeline_throughput') && (
              <ChipRow label="Pipeline" options={pipelines} value={pipelineId} onSelect={setPipelineId} />
            )}
            {reportType === 'personnel_comparison' && (
              <View className="mb-6">
                <View className="flex-row items-center mb-3">
                  <Text className="text-[10px] font-black uppercase tracking-[0.2em] text-typography-muted flex-1">Workers</Text>
                  <Text className="text-typography-muted text-[10px]">{selectedUserIds.length} selected</Text>
                </View>
                <HorizontalScroll>
                  {workers.map(w => {
                    const active = selectedUserIds.includes(w.id);
                    return (
                      <Pressable key={w.id} onPress={() => toggleMultiUser(w.id)} className={`px-4 py-2 mr-2 rounded-xl border ${active ? 'border-brand-primary bg-brand-primary/20' : 'border-surface-border bg-surface-card'}`}>
                        <Text className={`text-xs font-bold ${active ? 'text-brand-primary' : 'text-typography-muted'}`}>{w.full_name}</Text>
                      </Pressable>
                    );
                  })}
                </HorizontalScroll>
                {selectedUserIds.length > 0 && (
                  <View className="mt-4 gap-2">
                    <Text className="text-[10px] font-black uppercase tracking-[0.2em] text-typography-muted mb-1">Daily Rate (USD) — Optional</Text>
                    {selectedUserIds.map(uid => {
                      const w = workers.find(x => x.id === uid);
                      if (!w) return null;
                      return (
                        <View key={uid} className="flex-row items-center gap-3">
                          <Text className="text-typography-muted text-xs font-bold flex-1" numberOfLines={1}>{w.full_name}</Text>
                          <RNTextInput
                            value={salaries[uid]?.toString() ?? ''}
                            onChangeText={v => setSalaries(prev => ({ ...prev, [uid]: parseFloat(v) || 0 }))}
                            keyboardType="numeric"
                            placeholder="0.00"
                            className="border border-surface-border bg-surface-card rounded-xl px-3 py-2 text-typography-main text-xs w-24 text-right"
                            placeholderTextColor="rgb(var(--text-muted))"
                          />
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>
            )}
            {reportType === 'targets_status' && (
              <View className="bg-brand-primary/5 border border-brand-primary/20 p-5 rounded-2xl mb-6">
                <Text className="text-typography-main font-black text-sm mb-2">Company-Wide Scope</Text>
                <Text className="text-typography-muted text-xs leading-5">Includes all active, hit, and expired targets across every pipeline. No extra filters needed.</Text>
              </View>
            )}
            {reportType === 'personal_pulse' && (
              <View className="bg-brand-primary/5 border border-brand-primary/20 p-5 rounded-2xl mb-6">
                <Text className="text-typography-main font-black text-sm mb-2">Your Current Session</Text>
                <Text className="text-typography-muted text-xs leading-5">Captures your real-time daily/monthly points, active session time, and flap rate at generation time.</Text>
              </View>
            )}
          </>
        )}
        <View className="h-12" />
      </ScrollView>

      {/* Footer */}
      <View className={`px-6 py-6 border-t border-surface-border flex-row flex-wrap gap-4 ${isPage ? 'bg-surface-card pb-12' : 'bg-surface-card/50'}`}>
        {!isPage && (
          <Pressable onPress={onClose} disabled={loading} className="flex-1 min-w-[140px] py-4 rounded-2xl border border-surface-border bg-surface-background items-center">
            <Text className="text-typography-muted font-bold">Discard</Text>
          </Pressable>
        )}
        <Pressable
          onPress={handleGenerateReport}
          disabled={loading || pipelines.length === 0}
          className={`${isPage ? 'flex-1' : 'flex-[1.5]'} min-w-[160px] py-4 rounded-2xl items-center ${loading || pipelines.length === 0 ? 'bg-surface-border' : 'bg-brand-primary active:scale-95 shadow-lg shadow-brand-primary/20'}`}
        >
          {loading ? (
            <ActivityIndicator color="white" size="small" />
          ) : (
            <View className="flex-row items-center">
              <FontAwesome name="bolt" size={14} color="white" style={{ marginRight: 8 }} />
              <Text className="text-white font-black uppercase tracking-widest text-xs">Execute Generation</Text>
            </View>
          )}
        </Pressable>
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

function TypeCard({ opt, selected, onPress }: { opt: typeof REPORT_TYPES[number]; selected: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} className={`p-4 mb-3 rounded-2xl border flex-row items-center ${selected ? 'border-brand-primary bg-brand-primary/10' : 'border-surface-border bg-surface-card active:bg-surface-overlay'}`}>
      <View className={`h-10 w-10 items-center justify-center rounded-xl ${selected ? 'bg-brand-primary' : 'bg-surface-background'}`}>
        <FontAwesome name={opt.icon as any} size={16} color={selected ? 'white' : 'rgb(var(--brand-accent) / 0.5)'} />
      </View>
      <View className="ml-4 flex-1">
        <Text className={`font-bold ${selected ? 'text-brand-primary' : 'text-typography-main'}`}>{opt.label}</Text>
        <Text className="text-xs text-typography-muted mt-0.5" numberOfLines={1}>{opt.desc}</Text>
      </View>
      {selected && <FontAwesome name="check-circle" size={16} color="var(--color-primary)" />}
    </Pressable>
  );
}

function ChipRow({ label, options, value, onSelect, placeholder, labelKey = 'name' }: any) {
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
