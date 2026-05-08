import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  ScrollView,
  Pressable,
  ActivityIndicator,
  Alert,
  TextInput as RNTextInput,
} from 'react-native';
import HorizontalScroll from '@/components/common/HorizontalScroll';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import FontAwesome from '@expo/vector-icons/FontAwesome';

type ReportType = 'general' | 'worker_comparison' | 'team_comparison' | 'workflow_analysis';

interface ReportGeneratorProps {
  visible: boolean;
  onClose: () => void;
  onReportGenerated: () => void;
}

export default function ReportGenerator({
  visible,
  onClose,
  onReportGenerated,
}: ReportGeneratorProps) {
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
    if (visible) {
      loadFilterOptions();
    }
  }, [visible]);

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

      Alert.alert('Success', 'Report queued successfully!');
      onReportGenerated();
      onClose();
    } catch (error: any) {
      console.error('Report generation error:', error);
      Alert.alert('Error', error.message || 'Failed to generate report');
    } finally {
      setLoading(false);
    }
  };

  const renderReportTypeSelector = () => (
    <View className="mb-6">
      <Text className="text-[10px] font-black uppercase tracking-[0.2em] text-typography-muted mb-3">
        Report Architecture
      </Text>
      {[
        { value: 'general', label: 'General Performance Audit', desc: 'Organization or pipeline metrics', icon: 'bar-chart' },
        { value: 'worker_comparison', label: 'Worker Comparison', desc: 'Performance delta between 2 workers', icon: 'users' },
        { value: 'team_comparison', label: 'Team Comparison', desc: 'Strategic metrics across 2 teams', icon: 'group' },
        { value: 'workflow_analysis', label: 'Workflow Analysis', desc: 'Pipeline efficiency & bottleneck deep-dive', icon: 'rocket' },
      ].map((option) => (
        <Pressable
          key={option.value}
          onPress={() => setReportType(option.value as ReportType)}
          className={`p-4 mb-3 rounded-2xl border transition-all ${reportType === option.value 
            ? 'border-brand-primary bg-brand-primary/10' 
            : 'border-surface-border bg-surface-card hover:bg-surface-overlay active:scale-[0.98]'}`}
        >
          <View className="flex-row items-center">
            <View className={`h-10 w-10 items-center justify-center rounded-xl ${reportType === option.value ? 'bg-brand-primary' : 'bg-surface-background'}`}>
              <FontAwesome 
                name={option.icon as any} 
                size={16} 
                className={reportType === option.value ? 'text-white' : 'text-brand-accent/50'} 
              />
            </View>
            <View className="ml-4 flex-1">
              <Text className={`font-bold ${reportType === option.value ? 'text-brand-primary' : 'text-typography-main'}`}>{option.label}</Text>
              <Text className="text-xs text-typography-muted mt-0.5">{option.desc}</Text>
            </View>
            {reportType === option.value && (
              <FontAwesome name="check-circle" size={16} className="text-brand-accent" />
            )}
          </View>
        </Pressable>
      ))}
    </View>
  );

  const renderTimeFrameSelector = () => (
    <View className="mb-6">
      <Text className="text-[10px] font-black uppercase tracking-[0.2em] text-typography-muted mb-3">
        Temporal Scope
      </Text>
      <View className="flex-row gap-2 mb-3">
        {['7', '30', '90'].map((days) => (
          <Pressable
            key={days}
            onPress={() => setTimeFrame(days as '7' | '30' | '90')}
            className={`flex-1 py-3 rounded-xl border transition-all items-center ${timeFrame === days 
              ? 'border-brand-primary bg-brand-primary' 
              : 'border-surface-border bg-surface-card hover:bg-surface-overlay'}`}
          >
            <Text className={`font-bold ${timeFrame === days ? 'text-white' : 'text-typography-main'}`}>
              {days}D
            </Text>
          </Pressable>
        ))}
        <Pressable
          onPress={() => setTimeFrame('custom')}
          className={`flex-1 py-3 rounded-xl border transition-all items-center ${timeFrame === 'custom' 
            ? 'border-brand-primary bg-brand-primary' 
            : 'border-surface-border bg-surface-card hover:bg-surface-overlay'}`}
        >
          <Text className={`font-bold ${timeFrame === 'custom' ? 'text-white' : 'text-typography-main'}`}>
            Custom
          </Text>
        </Pressable>
      </View>

      {timeFrame === 'custom' && (
        <View className="gap-2">
          <RNTextInput
            placeholder="Start Date (YYYY-MM-DD)"
            value={dateStart}
            onChangeText={setDateStart}
            className="border border-surface-border bg-surface-card rounded-xl p-4 text-typography-main"
            placeholderTextColor="rgb(var(--text-muted))"
          />
          <RNTextInput
            placeholder="End Date (YYYY-MM-DD)"
            value={dateEnd}
            onChangeText={setDateEnd}
            className="border border-surface-border bg-surface-card rounded-xl p-4 text-typography-main"
            placeholderTextColor="rgb(var(--text-muted))"
          />
        </View>
      )}
    </View>
  );

  const renderGeneralFilters = () => (
    <>
      <View className="mb-6">
        <Text className="text-[10px] font-black uppercase tracking-[0.2em] text-typography-muted mb-3">
          Pipeline Context
        </Text>
        <HorizontalScroll>
          <Pressable
            onPress={() => setPipelineId('')}
            className={`px-5 py-2 mr-2 rounded-full border transition-all ${!pipelineId 
              ? 'border-brand-primary bg-brand-primary' 
              : 'border-surface-border bg-surface-card'}`}
          >
            <Text className={`font-bold text-xs ${!pipelineId ? 'text-white' : 'text-typography-main'}`}>
              Global Organization
            </Text>
          </Pressable>
          {pipelines.map((pipe) => (
            <Pressable
              key={pipe.id}
              onPress={() => setPipelineId(pipe.id)}
              className={`px-5 py-2 mr-2 rounded-full border transition-all ${pipelineId === pipe.id 
                ? 'border-brand-primary bg-brand-primary' 
                : 'border-surface-border bg-surface-card'}`}
            >
              <Text className={`font-bold text-xs ${pipelineId === pipe.id ? 'text-white' : 'text-typography-main'}`}>
                {pipe.name}
              </Text>
            </Pressable>
          ))}
        </HorizontalScroll>
      </View>

      <View className="mb-6">
        <Text className="text-[10px] font-black uppercase tracking-[0.2em] text-typography-muted mb-3">
          Structural Filters (Optional)
        </Text>
        
        <View className="mb-4">
          <Text className="text-xs font-bold text-typography-dim mb-2 ml-1">Team Unit</Text>
          <HorizontalScroll>
            <Pressable
              onPress={() => setTeamId('')}
              className={`px-4 py-2 mr-2 rounded-xl border ${!teamId ? 'border-brand-primary bg-brand-primary/20' : 'border-surface-border bg-surface-card'}`}
            >
              <Text className={`text-xs font-bold ${!teamId ? 'text-brand-primary' : 'text-typography-muted'}`}>All Teams</Text>
            </Pressable>
            {teams.map((team) => (
              <Pressable
                key={team.id}
                onPress={() => setTeamId(team.id)}
                className={`px-4 py-2 mr-2 rounded-xl border ${teamId === team.id ? 'border-brand-primary bg-brand-primary/20' : 'border-surface-border bg-surface-card'}`}
              >
                <Text className={`text-xs font-bold ${teamId === team.id ? 'text-brand-primary' : 'text-typography-muted'}`}>{team.name}</Text>
              </Pressable>
            ))}
          </HorizontalScroll>
        </View>

        <View className="mb-4">
          <Text className="text-xs font-bold text-typography-dim mb-2 ml-1">Individual Worker</Text>
          <HorizontalScroll>
            <Pressable
              onPress={() => setWorkerId('')}
              className={`px-4 py-2 mr-2 rounded-xl border ${!workerId ? 'border-brand-primary bg-brand-primary/20' : 'border-surface-border bg-surface-card'}`}
            >
              <Text className={`text-xs font-bold ${!workerId ? 'text-brand-primary' : 'text-typography-muted'}`}>All Personnel</Text>
            </Pressable>
            {workers.map((worker) => (
              <Pressable
                key={worker.id}
                onPress={() => setWorkerId(worker.id)}
                className={`px-4 py-2 mr-2 rounded-xl border ${workerId === worker.id ? 'border-brand-primary bg-brand-primary/20' : 'border-surface-border bg-surface-card'}`}
              >
                <Text className={`text-xs font-bold ${workerId === worker.id ? 'text-brand-primary' : 'text-typography-muted'}`}>{worker.full_name}</Text>
              </Pressable>
            ))}
          </HorizontalScroll>
        </View>

        <View className="mb-4">
          <Text className="text-xs font-bold text-typography-dim mb-2 ml-1">Priority Tier</Text>
          <HorizontalScroll>
            {['all', 'low', 'medium', 'high', 'critical'].map((p) => (
              <Pressable
                key={p}
                onPress={() => setPriorityFilter(p === 'all' ? '' : p)}
                className={`px-4 py-2 mr-2 rounded-xl border ${((p === 'all' && !priorityFilter) || priorityFilter === p) ? 'border-brand-primary bg-brand-primary/20' : 'border-surface-border bg-surface-card'}`}
              >
                <Text className={`text-xs font-bold capitalize ${((p === 'all' && !priorityFilter) || priorityFilter === p) ? 'text-brand-primary' : 'text-typography-muted'}`}>
                  {p}
                </Text>
              </Pressable>
            ))}
          </HorizontalScroll>
        </View>
      </View>
    </>
  );

  const renderWorkerComparisonFilters = () => (
    <View className="mb-6">
      <Text className="text-[10px] font-black uppercase tracking-[0.2em] text-typography-muted mb-3">
        Comparison Subjects
      </Text>
      
      <View className="mb-4">
        <Text className="text-xs font-bold text-typography-dim mb-2 ml-1">Worker Alpha</Text>
        <HorizontalScroll>
          {workers.map((w) => (
            <Pressable
              key={w.id}
              onPress={() => setWorkerA_id(w.id)}
              className={`px-4 py-2 mr-2 rounded-xl border ${workerA_id === w.id ? 'border-brand-primary bg-brand-primary/20' : 'border-surface-border bg-surface-card'}`}
            >
              <Text className={`text-xs font-bold ${workerA_id === w.id ? 'text-brand-primary' : 'text-typography-muted'}`}>{w.full_name}</Text>
            </Pressable>
          ))}
        </HorizontalScroll>
      </View>

      <View className="mb-4">
        <Text className="text-xs font-bold text-typography-dim mb-2 ml-1">Worker Beta</Text>
        <HorizontalScroll>
          {workers.map((w) => (
            <Pressable
              key={w.id}
              onPress={() => setWorkerB_id(w.id)}
              className={`px-4 py-2 mr-2 rounded-xl border ${workerB_id === w.id ? 'border-brand-primary bg-brand-primary/20' : 'border-surface-border bg-surface-card'}`}
            >
              <Text className={`text-xs font-bold ${workerB_id === w.id ? 'text-brand-primary' : 'text-typography-muted'}`}>{w.full_name}</Text>
            </Pressable>
          ))}
        </HorizontalScroll>
      </View>
    </View>
  );

  const renderTeamComparisonFilters = () => (
    <View className="mb-6">
      <Text className="text-[10px] font-black uppercase tracking-[0.2em] text-typography-muted mb-3">
        Strategic Comparison
      </Text>
      
      <View className="mb-4">
        <Text className="text-xs font-bold text-typography-dim mb-2 ml-1">Team Alpha</Text>
        <HorizontalScroll>
          {teams.map((t) => (
            <Pressable
              key={t.id}
              onPress={() => setTeamA_id(t.id)}
              className={`px-4 py-2 mr-2 rounded-xl border ${teamA_id === t.id ? 'border-brand-primary bg-brand-primary/20' : 'border-surface-border bg-surface-card'}`}
            >
              <Text className={`text-xs font-bold ${teamA_id === t.id ? 'text-brand-primary' : 'text-typography-muted'}`}>{t.name}</Text>
            </Pressable>
          ))}
        </HorizontalScroll>
      </View>

      <View className="mb-4">
        <Text className="text-xs font-bold text-typography-dim mb-2 ml-1">Team Beta</Text>
        <HorizontalScroll>
          {teams.map((t) => (
            <Pressable
              key={t.id}
              onPress={() => setTeamB_id(t.id)}
              className={`px-4 py-2 mr-2 rounded-xl border ${teamB_id === t.id ? 'border-brand-primary bg-brand-primary/20' : 'border-surface-border bg-surface-card'}`}
            >
              <Text className={`text-xs font-bold ${teamB_id === t.id ? 'text-brand-primary' : 'text-typography-muted'}`}>{t.name}</Text>
            </Pressable>
          ))}
        </HorizontalScroll>
      </View>
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" transparent={true}>
      <View className="flex-1 justify-center items-center bg-black/40 p-4 lg:p-10">
        <View className="w-full max-w-2xl h-[90%] bg-surface-background rounded-[32px] border border-surface-border overflow-hidden premium-shadow glass-card">
          {/* Header */}
          <View className="px-6 py-5 border-b border-surface-border flex-row items-center justify-between bg-surface-card/50">
            <View className="flex-row items-center">
              <View className="h-10 w-1 rounded-full bg-brand-primary mr-4" />
              <View>
                <Text className="text-lg font-black uppercase tracking-widest text-typography-main">
                  Analytics Hub
                </Text>
                <Text className="text-[10px] font-bold text-brand-primary uppercase tracking-tighter">
                  Intelligence Engine v8.0
                </Text>
              </View>
            </View>
            <Pressable 
              onPress={onClose}
              className="h-10 w-10 items-center justify-center rounded-full bg-surface-background border border-surface-border hover:bg-surface-overlay active:scale-90 transition-all"
            >
              <FontAwesome name="close" size={16} className="text-brand-accent" />
            </Pressable>
          </View>

          {/* Content */}
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
                       <Text className="text-typography-muted text-center mb-8 leading-relaxed text-sm">
                         No pipelines detected. Report generation requires at least one active pipeline to analyze.
                       </Text>
                       <Pressable
                         onPress={() => {
                           onClose();
                           // We can't push from here easily if it's a modal, but the user is likely on a screen that can handle navigation or we assume they'll close and go there.
                           // Actually we should probably just show the message.
                         }}
                         className="bg-brand-primary px-8 py-3 rounded-xl active:scale-95 transition-all"
                       >
                         <Text className="text-white font-black uppercase tracking-widest text-[10px]">Configure Pipelines</Text>
                       </Pressable>
                     </>
                   ) : (
                     <View className="bg-state-info-dim border border-state-info/20 p-6 rounded-2xl w-full">
                       <View className="flex-row items-start">
                         <FontAwesome name="info-circle" size={16} color="rgb(var(--state-info))" style={{ marginTop: 2 }} />
                         <View className="ml-4 flex-1">
                            <Text className="text-typography-main text-base font-black mb-1">Access Restricted</Text>
                            <Text className="text-typography-muted text-xs font-bold leading-relaxed">
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
                {renderReportTypeSelector()}
                <View className="h-px bg-surface-border mb-6" />
                {renderTimeFrameSelector()}
                <View className="h-px bg-surface-border mb-6" />

                {reportType === 'general' && renderGeneralFilters()}
                {reportType === 'worker_comparison' && renderWorkerComparisonFilters()}
                {reportType === 'team_comparison' && renderTeamComparisonFilters()}
                {reportType === 'workflow_analysis' && renderGeneralFilters()}
              </>
            )}
            
            <View className="h-12" />
          </ScrollView>

          {/* Footer */}
          <View className="px-6 py-6 border-t border-surface-border flex-row gap-4 bg-surface-card/50">
            <Pressable
              onPress={onClose}
              disabled={loading}
              className="flex-1 py-4 rounded-2xl border border-surface-border bg-surface-background hover:bg-surface-overlay active:scale-95 transition-all items-center"
            >
              <Text className="text-typography-muted font-bold">Discard</Text>
            </Pressable>

            <Pressable
              onPress={handleGenerateReport}
              disabled={loading || pipelines.length === 0}
              className={`flex-[1.5] py-4 rounded-2xl transition-all items-center ${loading || pipelines.length === 0 ? 'bg-surface-border' : 'bg-brand-primary hover:bg-brand-primary-hover active:scale-95 shadow-lg shadow-brand-primary/20'}`}
            >
              {loading ? (
                <ActivityIndicator color="white" size="small" />
              ) : (
                <View className="flex-row items-center">
                   <FontAwesome name="bolt" size={14} className="text-white mr-2" />
                  <Text className="text-white font-black uppercase tracking-widest text-xs">Execute Generation</Text>
                </View>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}
