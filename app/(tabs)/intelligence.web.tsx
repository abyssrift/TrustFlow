import ConfirmModal from '@/components/common/ConfirmModal';
import { useAuth } from '@/contexts/AuthContext';
import { useDebounce } from '@/hooks/useDebounce';
import { supabase } from '@/lib/supabase';
import { FontAwesome } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Linking from 'expo-linking';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, TouchableOpacity, View } from 'react-native';

import { SectionToggle } from '@/components/intelligence/IntelligenceCommon';
import { ReportConfigModal, SnapshotDetailModal, TargetCreationModal, WidgetConfigModal } from '@/components/intelligence/IntelligenceModals';
import { ArchivesSectionWeb, RadarSectionWeb, TargetsSectionWeb } from '@/components/intelligence/IntelligenceSections';

// --- MAIN SCREEN COMPONENT ---

export default function IntelligenceScreenWeb() {
  const { section } = useLocalSearchParams();
  const router = useRouter();
  const [activeSection, setActiveSection] = useState((section as string) || 'radar');
  const [loading, setLoading] = useState(true);
  const [showReportModal, setShowReportModal] = useState(false);
  const [showTargetModal, setShowTargetModal] = useState(false);

  const [data, setData] = useState<any>(null);
  const [reports, setReports] = useState<any[]>([]);
  const [coldArchives, setColdArchives] = useState<any[]>([]);
  const [archiveSearch, setArchiveSearch] = useState('');
  const debouncedSearch = useDebounce(archiveSearch, 500);
  const [targets, setTargets] = useState<any[]>([]);
  
  // Restoration State
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [restoreModal, setRestoreModal] = useState<{ visible: boolean, archive?: any }>({ visible: false });
  const [snapshotModal, setSnapshotModal] = useState<{ visible: boolean, data?: any }>({ visible: false });

  // Base Data for Selectors
  const [pipelines, setPipelines] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [allStages, setAllStages] = useState<any[]>([]);
  const [activeSchema, setActiveSchema] = useState<{ pipelines: Set<string>, stages: Set<string> }>({ 
    pipelines: new Set(), 
    stages: new Set() 
  });

  // Current Global State
  const [days, setDays] = useState(30);
  const [pipelineId, setPipelineId] = useState<string | null>(null);

  // Widget Customization State
  const DEFAULT_WIDGETS = ['throughput', 'efficiency', 'flow_ratio', 'first_pass_yield'];
  const [activeWidgets, setActiveWidgets] = useState<string[]>(DEFAULT_WIDGETS);
  const [showWidgetModal, setShowWidgetModal] = useState(false);

  const { hasPermission, profile } = useAuth();

  useEffect(() => {
    AsyncStorage.getItem('@TrustFlow_radar_widgets').then(val => {
      if (val) setActiveWidgets(JSON.parse(val));
    });
    fetchBaseData();
  }, []);

  useEffect(() => {
    if (section && typeof section === 'string') {
      if (section === 'archives' && !hasPermission('archive.view')) {
        setActiveSection('radar');
        return;
      }
      setActiveSection(section);
    }
  }, [section, hasPermission]);

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
      if (activeSection === 'archives') {
        await fetchReports();
        await fetchColdArchives();
      }
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

  useEffect(() => {
    if (activeSection === 'archives') {
      fetchColdArchives();
    }
  }, [debouncedSearch]);

  const fetchColdArchives = async () => {
    setLoading(true);
    try {
      // 1. Fetch Archives
      const { data: archiveData, error: archiveError } = await supabase.rpc('rpc_get_archives', {
        p_search: debouncedSearch || null
      });
      if (archiveError) throw archiveError;
      setColdArchives(archiveData || []);

      // 2. Fetch Schema Baseline for Integrity Check
      const [pipelinesRes, stagesRes] = await Promise.all([
        supabase.from('pipelines').select('id'),
        supabase.from('pipeline_stages').select('id')
      ]);

      setActiveSchema({
        pipelines: new Set(pipelinesRes.data?.map(p => p.id) || []),
        stages: new Set(stagesRes.data?.map(s => s.id) || [])
      });
    } catch (err) {
      console.error('[Intelligence] Archive fetch failed:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = async (archive: any) => {
    try {
      setLoading(true);
      setRestoringId(archive.id);

      const isTask = archive.entity_type === 'task';
      const targetId = isTask ? archive.snapshot?.task?.current_stage_id : archive.snapshot?.project?.pipeline_id;
      const set = isTask ? activeSchema.stages : activeSchema.pipelines;

      if (targetId && !set.has(targetId)) {
        throw new Error(`Integrity Violation: The target ${isTask ? 'stage' : 'pipeline'} for this snapshot has been deleted. Manual remapping is required.`);
      }

      const rpcName = archive.entity_type === 'project' ? 'rpc_restore_project' : 'rpc_restore_archive';
      const { data, error } = await supabase.rpc(rpcName, { p_archive_id: archive.id });
      
      if (error) throw error;
      
      // Refresh list
      await fetchColdArchives();
      setRestoreModal({ visible: false });
      
      // Navigate to restored entity
      if (archive.entity_type === 'project') {
        router.push('/projects');
      } else {
        router.push(`/task/${data}`);
      }
    } catch (err: any) {
      console.error('Restoration Failed:', err);
      Alert.alert('Restoration Failed', err.message);
    } finally {
      setLoading(false);
      setRestoringId(null);
    }
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
        company_id: profile?.company_id,
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
      <View className="max-w-[1600px] mx-auto w-full flex-1">
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

        <SectionToggle active={activeSection} onSelect={setActiveSection} hasPermission={hasPermission} />

        <ScrollView className="flex-1" contentContainerClassName="pb-16 flex-grow" showsVerticalScrollIndicator={false}>
          {loading ? (
            <View className="py-40 items-center justify-center">
              <ActivityIndicator size="large" color="rgb(var(--brand-primary))" />
            </View>
          ) : pipelines.length === 0 ? (
            <View className="py-20 items-center justify-center">
              <View className="bg-surface-card p-12 rounded-[3rem] border border-surface-border items-center max-w-[600px] premium-shadow">
                <View className="w-20 h-20 bg-brand-primary/10 rounded-full items-center justify-center mb-6">
                  <FontAwesome name="line-chart" size={32} color="rgb(var(--brand-primary))" />
                </View>
                
                {hasPermission('pipeline.edit') ? (
                  <>
                    <Text className="text-typography-main text-3xl font-black mb-2 text-center">Intelligence Unavailable</Text>
                    <Text className="text-typography-muted text-center mb-8 leading-relaxed">
                      No workflow pipelines found. Intelligence analytics and benchmarking require at least one active pipeline to aggregate data.
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
                  archives={coldArchives}
                  search={archiveSearch}
                  activeSchema={activeSchema}
                  onSearch={setArchiveSearch}
                  onDownload={handleDownloadReport}
                  onNew={() => setShowReportModal(true)}
                  onRefresh={fetchColdArchives}
                  onRestore={(a: any) => setRestoreModal({ visible: true, archive: a })}
                  onViewSnapshot={(a: any) => setSnapshotModal({ visible: true, data: a.snapshot })}
                  hasPermission={hasPermission}
                />
              )}
            </View>
          )}
        </ScrollView>
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

      <ConfirmModal
        visible={restoreModal.visible}
        title={`Restore ${restoreModal.archive?.entity_type === 'project' ? 'Project' : 'Task'}`}
        description={`This will move "${restoreModal.archive?.metadata?.title}" back to the active pipeline. All historical data and attachments will be recovered.`}
        confirmLabel="Restore Data"
        variant="primary"
        loading={!!restoringId}
        onConfirm={() => restoreModal.archive && handleRestore(restoreModal.archive)}
        onCancel={() => setRestoreModal({ visible: false })}
      />

      <SnapshotDetailModal
        visible={snapshotModal.visible}
        data={snapshotModal.data}
        onClose={() => setSnapshotModal({ visible: false })}
      />
    </View>
  );
}
