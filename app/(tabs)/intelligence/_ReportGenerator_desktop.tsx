import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  TextInput as RNTextInput,
} from 'react-native';
import HorizontalScroll from '@/components/common/HorizontalScroll';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { Stack, useRouter } from 'expo-router';

type ReportType = 'general' | 'worker_comparison' | 'team_comparison' | 'workflow_analysis';

export default function ReportGeneratorWeb() {
  const router = useRouter();
  const { hasPermission } = useAuth();

  // State
  const [reportType, setReportType] = useState<ReportType>('general');
  const [timeFrame, setTimeFrame] = useState<'7' | '30' | '90' | 'custom'>('30');
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  const [pipelineId, setPipelineId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [workerId, setWorkerId] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [projectId, setProjectId] = useState('');
  const [workerA_id, setWorkerA_id] = useState('');
  const [workerB_id, setWorkerB_id] = useState('');
  const [teamA_id, setTeamA_id] = useState('');
  const [teamB_id, setTeamB_id] = useState('');

  const [pipelines, setPipelines] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [workers, setWorkers] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // Load options
  useEffect(() => {
    loadFilterOptions();
  }, []);

  const loadFilterOptions = async () => {
    try {
      const [pipeRes, teamRes, workerRes, projRes] = await Promise.all([
        supabase.from('pipelines').select('id, name').is('deleted_at', null).order('name'),
        supabase.from('teams').select('id, name').is('deleted_at', null).order('name'),
        supabase.from('users').select('id, full_name').is('deleted_at', null).order('full_name'),
        supabase.from('projects').select('id, name').is('deleted_at', null).order('name'),
      ]);

      setPipelines(pipeRes.data || []);
      setTeams(teamRes.data || []);
      setWorkers(workerRes.data || []);
      setProjects(projRes.data || []);
    } catch (error) {
      console.error('Error loading filter options:', error);
    }
  };

  const handleGenerateReport = async () => {
    try {
      setLoading(true);

      let days = 30;
      let dateStartParam = null;
      let dateEndParam = null;

      if (timeFrame === 'custom') {
        dateStartParam = dateStart ? new Date(dateStart).toISOString() : null;
        dateEndParam = dateEnd ? new Date(dateEnd).toISOString() : null;
        if (!dateStartParam || !dateEndParam) {
          Alert.alert('Error', 'Please provide both start and end dates');
          setLoading(false);
          return;
        }
      } else {
        days = parseInt(timeFrame);
      }

      const parameters: any = {
        days: days,
        scope: reportType === 'general' ? (pipelineId ? 'pipeline' : 'organization') : reportType,
      };

      if (pipelineId) parameters.pipeline_id = pipelineId;
      if (teamId) parameters.team_id = teamId;
      if (workerId) parameters.worker_id = workerId;
      if (priorityFilter) parameters.priority = priorityFilter;
      if (projectId) parameters.project_id = projectId;
      if (dateStartParam) parameters.date_start = dateStartParam;
      if (dateEndParam) parameters.date_end = dateEndParam;

      if (reportType === 'worker_comparison') {
        if (!workerA_id || !workerB_id) {
          Alert.alert('Error', 'Please select both workers for comparison');
          setLoading(false);
          return;
        }
        parameters.worker_a_id = workerA_id;
        parameters.worker_b_id = workerB_id;
      }

      if (reportType === 'team_comparison') {
        if (!teamA_id || !teamB_id) {
          Alert.alert('Error', 'Please select both teams for comparison');
          setLoading(false);
          return;
        }
        parameters.team_a_id = teamA_id;
        parameters.team_b_id = teamB_id;
      }

      const { data: jobId, error } = await supabase.rpc('rpc_request_report', {
        p_report_type: reportType,
        p_parameters: parameters,
      });

      if (error) throw error;

      if (jobId) {
        try {
          await fetch(
            'https://wbvgufqfgbvbinjrdzlg.functions.supabase.co/generate-pdf-report-v8',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ job_id: jobId }),
            }
          );
        } catch (fetchErr) {
          console.warn('Edge function trigger error:', fetchErr);
        }
      }

      Alert.alert('Success', 'Report queued successfully! It will appear in your Archives shortly.');
      router.replace('/intelligence?section=archives');
    } catch (error: any) {
      console.error('Report generation error:', error);
      Alert.alert('Error', error.message || 'Failed to generate report');
    } finally {
      setLoading(false);
    }
  };

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
                           Either no pipelines exist now, or they're not privileged enough to see them, contact company Admin
                         </Text>
                      </View>
                    </View>
                  </View>
                )}
              </View>
            </View>
          ) : (
            <>
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
                   <FontAwesome name="bolt" size={16} color="white" className="mr-3" />
                   <Text className="text-white font-black uppercase tracking-[0.2em] text-sm">Deploy Generation</Text>
                 </>
               )}
            </TouchableOpacity>
          </View>

          <View className="flex-row gap-12">
            {/* Left Column: Configuration */}
            <View className="flex-[1.5] gap-10">
              
              {/* Step 1: Architecture */}
              <View className="bg-surface-card p-10 rounded-[48px] border border-surface-border">
                <Text className="text-typography-muted text-xs font-black uppercase tracking-[0.2em] mb-8 opacity-60">01. Architecture Type</Text>
                <View className="gap-4">
                  {[
                    { value: 'general', label: 'Tactical Performance Audit', desc: 'Holistic organization or pipeline metrics', icon: 'bar-chart' },
                    { value: 'worker_comparison', label: 'Personnel Benchmarking', desc: 'Delta analysis between two deployment assets', icon: 'users' },
                    { value: 'team_comparison', label: 'Structural Matrix Analysis', desc: 'Efficiency metrics across structural units', icon: 'group' },
                    { value: 'workflow_analysis', label: 'Pipeline Bottleneck Scan', desc: 'Stage-by-stage efficiency & delay deep-dive', icon: 'rocket' },
                  ].map((option) => (
                    <TouchableOpacity
                      key={option.value}
                      onPress={() => setReportType(option.value as ReportType)}
                      className={`p-6 rounded-[32px] border flex-row items-center transition-all ${reportType === option.value 
                        ? 'border-brand-primary bg-brand-primary/10' 
                        : 'border-surface-border bg-surface-background/40 hover:bg-surface-overlay'}`}
                    >
                      <View className={`h-16 w-16 items-center justify-center rounded-2xl ${reportType === option.value ? 'bg-brand-primary' : 'bg-surface-card'}`}>
                        <FontAwesome 
                          name={option.icon as any} 
                          size={24} 
                          className={reportType === option.value ? 'text-white' : 'text-brand-accent/30'} 
                        />
                      </View>
                      <View className="ml-6 flex-1">
                        <Text className={`text-lg font-black ${reportType === option.value ? 'text-brand-primary' : 'text-typography-main'}`}>{option.label}</Text>
                        <Text className="text-typography-muted mt-1 font-medium">{option.desc}</Text>
                      </View>
                      {reportType === option.value && (
                        <View className="h-8 w-8 rounded-full bg-brand-primary items-center justify-center">
                           <FontAwesome name="check" size={12} color="white" />
                        </View>
                      )}
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Step 2: Temporal Filters */}
              <View className="bg-surface-card p-10 rounded-[48px] border border-surface-border">
                <Text className="text-typography-muted text-xs font-black uppercase tracking-[0.2em] mb-8 opacity-60">02. Temporal Scope</Text>
                <View className="flex-row gap-4 mb-8">
                  {['7', '30', '90'].map((days) => (
                    <TouchableOpacity
                      key={days}
                      onPress={() => setTimeFrame(days as any)}
                      className={`flex-1 py-5 rounded-2xl border items-center transition-all ${timeFrame === days 
                        ? 'border-brand-primary bg-brand-primary' 
                        : 'border-surface-border bg-surface-background/40 hover:bg-surface-overlay'}`}
                    >
                      <Text className={`font-black uppercase tracking-widest ${timeFrame === days ? 'text-white' : 'text-typography-main'}`}>
                        {days} Days
                      </Text>
                    </TouchableOpacity>
                  ))}
                  <TouchableOpacity
                    onPress={() => setTimeFrame('custom')}
                    className={`flex-1 py-5 rounded-2xl border items-center transition-all ${timeFrame === 'custom' 
                      ? 'border-brand-primary bg-brand-primary' 
                      : 'border-surface-border bg-surface-background/40 hover:bg-surface-overlay'}`}
                  >
                    <Text className={`font-black uppercase tracking-widest ${timeFrame === 'custom' ? 'text-white' : 'text-typography-main'}`}>
                      Custom Range
                    </Text>
                  </TouchableOpacity>
                </View>

                {timeFrame === 'custom' && (
                  <View className="flex-row gap-4 animate-in fade-in slide-in-from-top-4">
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
            </View>

            {/* Right Column: Tactical Parameters */}
            <View className="flex-1">
              <View className="bg-surface-card p-10 rounded-[48px] border border-surface-border sticky top-12">
                <Text className="text-typography-muted text-xs font-black uppercase tracking-[0.2em] mb-8 opacity-60">03. Tactical Parameters</Text>
                
                <ScrollView showsVerticalScrollIndicator={false} className="max-h-[70vh]">
                  {reportType === 'general' || reportType === 'workflow_analysis' ? (
                    <>
                      <ParameterSection title="Pipeline Focus" options={pipelines} value={pipelineId} onSelect={setPipelineId} placeholder="All Pipelines" />
                      <ParameterSection title="Unit Allocation" options={teams} value={teamId} onSelect={setTeamId} placeholder="All Teams" />
                      <ParameterSection title="Individual Asset" options={workers} value={workerId} onSelect={setWorkerId} placeholder="All Personnel" labelKey="full_name" />
                      <ParameterSection title="Priority Tier" options={[{id: 'low', name: 'Low'}, {id: 'medium', name: 'Medium'}, {id: 'high', name: 'High'}, {id: 'critical', name: 'Critical'}]} value={priorityFilter} onSelect={setPriorityFilter} placeholder="All Tiers" />
                    </>
                  ) : reportType === 'worker_comparison' ? (
                    <>
                      <ParameterSection title="Asset Alpha" options={workers} value={workerA_id} onSelect={setWorkerA_id} placeholder="Select Worker" labelKey="full_name" />
                      <ParameterSection title="Asset Beta" options={workers} value={workerB_id} onSelect={setWorkerB_id} placeholder="Select Worker" labelKey="full_name" />
                    </>
                  ) : (
                    <>
                      <ParameterSection title="Unit Alpha" options={teams} value={teamA_id} onSelect={setTeamA_id} placeholder="Select Team" />
                      <ParameterSection title="Unit Beta" options={teams} value={teamB_id} onSelect={setTeamB_id} placeholder="Select Team" />
                    </>
                  )}
                </ScrollView>

                <View className="mt-10 pt-10 border-t border-surface-border">
                   <View className="bg-surface-background p-6 rounded-3xl border border-surface-border">
                      <View className="flex-row items-center mb-4">
                        <FontAwesome name="shield" size={14} className="text-brand-primary mr-3" />
                        <Text className="text-[10px] font-black uppercase tracking-widest text-typography-main">Data Sovereignty</Text>
                      </View>
                      <Text className="text-typography-muted text-xs leading-5 font-medium">
                        Reports are generated asynchronously. High-volume data sets may require up to 120 seconds for full packet reconstruction.
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

function ParameterSection({ title, options, value, onSelect, placeholder, labelKey = 'name' }: any) {
  return (
    <View className="mb-8">
      <Text className="text-typography-main text-xs font-black uppercase tracking-widest mb-4 ml-1">{title}</Text>
      <View className="flex-row flex-wrap gap-2">
        <TouchableOpacity
          onPress={() => onSelect('')}
          className={`px-4 py-2.5 rounded-xl border transition-all ${!value ? 'bg-brand-primary border-brand-primary shadow-sm' : 'bg-surface-background border-surface-border hover:bg-surface-overlay'}`}
        >
          <Text className={`text-[11px] font-black uppercase tracking-tighter ${!value ? 'text-white' : 'text-typography-muted'}`}>{placeholder}</Text>
        </TouchableOpacity>
        {options.map((opt: any) => (
          <TouchableOpacity
            key={opt.id}
            onPress={() => onSelect(opt.id)}
            className={`px-4 py-2.5 rounded-xl border transition-all ${value === opt.id ? 'bg-brand-primary border-brand-primary shadow-sm' : 'bg-surface-background border-surface-border hover:bg-surface-overlay'}`}
          >
            <Text className={`text-[11px] font-black uppercase tracking-tighter ${value === opt.id ? 'text-white' : 'text-typography-main'}`}>{opt[labelKey]}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}
