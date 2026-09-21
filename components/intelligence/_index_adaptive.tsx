import ConfirmModal from '@/components/common/ConfirmModal';
import Popup from '@/components/common/Popup';
import ReportGeneratorAdaptive from '@/components/intelligence/_ReportGenerator_adaptive';
import { BackButton } from '@/components/common/BackButton';
import { IntelligencePicker } from '@/components/intelligence/IntelligenceCommon';
import ProjectLens from '@/components/intelligence/ProjectLens';
import AtAGlance from '@/components/intelligence/AtAGlance';
import TargetWatch from '@/components/intelligence/TargetWatch';
import Tooltip from '@/components/common/Tooltip';

import { useAlert } from '@/contexts/AlertContext';
import { useToast } from '@/contexts/ToastContext';
import { useAuth } from '@/contexts/AuthContext';
import { useThemeColors } from '@/hooks/useThemeColors';
import { useCapability } from '@/hooks/useCapability';
import type { OrganizationalAudit } from '@/lib/analyticsMetrics';
import { useAnalytics } from '@/contexts/AnalyticsContext';
import { supabase } from '@/lib/supabase';
import { FontAwesome } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, RefreshControl, ScrollView, Text, TouchableOpacity, View } from 'react-native';



// --- UTILITIES & SUB-COMPONENTS (Defined BEFORE main screen to avoid non-hoisted variable errors) ---

const SectionToggle = ({ active, onSelect, hasPermission }: { active: string, onSelect: (s: string) => void, hasPermission: (p: string) => boolean }) => {
  const colors = useThemeColors();
  const sections = ['Radar', 'Archives', 'Analytics'].filter(s => {
    if (s === 'Archives') return hasPermission('archive.view');
    if (s === 'Analytics') return hasPermission('analytics.view');
    return true;
  });
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mx-6 mb-6">
      <View className="flex-row bg-surface-card rounded-2xl p-1 border border-surface-border">
        {sections.map((s) => (
          <TouchableOpacity
            key={s}
            onPress={() => onSelect(s.toLowerCase())}
            accessibilityRole="tab"
            accessibilityLabel={`Show ${s}`}
            accessibilityState={{ selected: active === s.toLowerCase() }}
            className={`min-h-[44px] px-5 py-3 rounded-xl items-center justify-center ${active === s.toLowerCase() ? 'bg-brand-primary' : ''}`}
          >
            <Text className={`font-bold text-xs ${active === s.toLowerCase() ? 'text-brand-on-primary' : 'text-typography-muted'}`}>
              {s}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
};

const RadarSection = ({ data, targetWatchEnabled }: { data: OrganizationalAudit | null; targetWatchEnabled: boolean }) => {
  const colors = useThemeColors();
  if (!data) return <View className="py-12 items-center"><ActivityIndicator color={colors.primary} /></View>;
  return (
    <View>
      <View className="mb-6"><AtAGlance audit={data} /></View>
      {targetWatchEnabled && <View className="mb-6"><TargetWatch enabled /></View>}
      <View className="mb-6">
        <ProjectLens />
      </View>
    </View>
  );
};



const ArchivesSection = ({ reports, onDownload, onNew, canGenerate, coldArchives, activeSchema, currentSubSection, setSubSection, onSelectArchive, hasPermission }: any) => {
  const colors = useThemeColors();
  return (
  <View>
    <View className="flex-row bg-surface-background p-1 rounded-xl mb-6">
      <Tooltip label="View generated reports" disabled={currentSubSection === 'reports'} className="flex-1">
        <TouchableOpacity onPress={() => setSubSection('reports')} accessibilityRole="tab" accessibilityLabel="View generated reports" accessibilityState={{ selected: currentSubSection === 'reports' }} className={`flex-1 min-h-[44px] py-3 rounded-lg items-center justify-center ${currentSubSection === 'reports' ? 'bg-brand-primary' : ''}`}>
          <Text className={`font-bold text-[10px] uppercase ${currentSubSection === 'reports' ? 'text-brand-on-primary' : 'text-typography-muted'}`}>Audit Reports</Text>
        </TouchableOpacity>
      </Tooltip>
      {hasPermission('archive.view') && (
        <Tooltip label="View archived assets" disabled={currentSubSection === 'storage'} className="flex-1">
          <TouchableOpacity onPress={() => setSubSection('storage')} accessibilityRole="tab" accessibilityLabel="View archived assets" accessibilityState={{ selected: currentSubSection === 'storage' }} className={`flex-1 min-h-[44px] py-3 rounded-lg items-center justify-center ${currentSubSection === 'storage' ? 'bg-brand-primary' : ''}`}>
            <Text className={`font-bold text-[10px] uppercase ${currentSubSection === 'storage' ? 'text-brand-on-primary' : 'text-typography-muted'}`}>Cold Storage</Text>
          </TouchableOpacity>
        </Tooltip>
      )}
    </View>
    {currentSubSection === 'reports' ? (
      <>
        {canGenerate && <TouchableOpacity onPress={onNew} className="bg-surface-card p-6 rounded-3xl border border-dashed border-brand-primary/40 mb-6 items-center flex-row justify-center">
          <FontAwesome name="plus-circle" size={16} color={colors.primary} className="mr-3" />
          <Text className="text-brand-primary font-bold text-sm">Generate Report</Text>
        </TouchableOpacity>}
        {reports.map((r: any, i: number) => (
          <TouchableOpacity key={i} onPress={() => r.file_url && onDownload(r.file_url)} className="bg-surface-card p-5 rounded-2xl border border-surface-border mb-4 flex-row items-center">
            <View className={`w-12 h-12 rounded-xl items-center justify-center mr-4 ${r.status === 'completed' ? 'bg-state-success/10' : 'bg-state-info/10'}`}>
              <FontAwesome name="file-text-o" size={18} color={r.status === 'completed' ? colors.success : colors.primary} />
            </View>
            <View className="flex-1">
              <Text className="text-typography-main font-bold">Report #{r.id.substring(0, 6)}</Text>
              <Text className="text-typography-muted text-xs">{new Date(r.created_at).toLocaleDateString()} • {r.status}</Text>
            </View>
            <FontAwesome name="chevron-right" size={12} color={colors.textMuted} />
          </TouchableOpacity>
        ))}
      </>
    ) : (
      <>
        {coldArchives.length === 0 ? (
          <View className="py-10 items-center justify-center">
            <FontAwesome name="archive" size={40} className="text-surface-border mb-4" />
            <Text className="text-typography-muted text-center font-bold">No assets in cold storage</Text>
          </View>
        ) : (
          coldArchives.map((archive: any) => {
            const pipelineId = archive.snapshot?.pipeline_id || archive.snapshot?.child_tasks?.[0]?.pipeline_id;
            const hasIntegrityIssue = pipelineId && !activeSchema.pipelines.has(pipelineId);
            return (
              <TouchableOpacity key={archive.id} onPress={() => onSelectArchive(archive)} className="bg-surface-card p-5 rounded-2xl border border-surface-border mb-4 flex-row items-center">
                <View className={`w-12 h-12 rounded-xl items-center justify-center mr-4 ${archive.restored_at ? 'bg-state-success/10' : 'bg-surface-background'}`}>
                  <FontAwesome name={archive.entity_type === 'project' ? 'folder-o' : 'tasks'} size={18} className={archive.restored_at ? 'text-state-success' : 'text-brand-primary'} />
                </View>
                <View className="flex-1">
                  <Text className="text-typography-main font-bold" numberOfLines={1}>
                    {archive.metadata?.title || archive.metadata?.name || 'Untitled'}
                  </Text>
                  <View className="flex-row items-center">
                    <Text className="text-typography-muted text-[10px]">{new Date(archive.archived_at).toLocaleDateString()}</Text>
                    {hasIntegrityIssue && (
                      <View className="ml-2 bg-state-danger/10 px-1.5 py-0.5 rounded flex-row items-center">
                        <FontAwesome name="exclamation-triangle" size={8} className="text-state-danger mr-1" />
                        <Text className="text-state-danger text-[8px] font-black uppercase">Broken</Text>
                      </View>
                    )}
                    {archive.restored_at && (
                      <View className="ml-2 bg-state-success/10 px-1.5 py-0.5 rounded">
                        <Text className="text-state-success text-[8px] font-black uppercase">Restored</Text>
                      </View>
                    )}
                  </View>
                </View>
                <FontAwesome name="chevron-right" size={12} color={colors.textMuted} />
              </TouchableOpacity>
            );
          })
        )}
      </>
    )}
  </View>
  );
};

const ReportConfigModal = ({ visible, onClose, onConfirm, pipelines, teams, users, initialDays }: any) => {
  const colors = useThemeColors();
  const [d, setD] = useState(initialDays);
  const [p, setP] = useState<string | null>(null);
  const [t, setT] = useState<string | null>(null);
  const [u, setU] = useState<string | null>(null);
  const [type, setType] = useState('performance_audit');
  return (
    <Popup visible={visible} onClose={onClose} presentation="auto" maxWidth={420}>
          <View className="p-8 pt-2 pb-4">
            <Text className="text-typography-main text-2xl font-black mb-1">Audit Configuration</Text>
            <Text className="text-typography-muted text-xs">Define intelligence boundaries</Text>
          </View>
          <ScrollView className="px-8" showsVerticalScrollIndicator={false}>
            <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-widest mt-4 mb-3">Timeframe</Text>
            <View className="flex-row gap-2">
              {[7, 30, 90].map(val => (
                <TouchableOpacity key={val} onPress={() => setD(val)} accessibilityRole="radio" accessibilityLabel={`${val} day timeframe`} accessibilityState={{ checked: d === val }} className={`flex-1 min-h-[44px] py-3 rounded-xl border items-center justify-center ${d === val ? 'bg-brand-primary border-brand-primary' : 'border-surface-border'}`}>
                  <Text className={`text-center font-bold text-xs ${d === val ? 'text-brand-on-primary' : 'text-typography-muted'}`}>{val} Days</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-widest mt-6 mb-3">Target Pipeline</Text>
            <IntelligencePicker items={[{ id: null, name: 'Organization Wide' }, ...pipelines]} selectedId={p} onSelect={setP} />
            <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-widest mt-6 mb-3">Filtered Team</Text>
            <IntelligencePicker items={[{ id: null, name: 'All Teams' }, ...teams]} selectedId={t} onSelect={setT} />
            <Text className="text-typography-muted text-[10px] font-bold uppercase tracking-widest mt-6 mb-3">Individual Scope</Text>
            <IntelligencePicker items={[{ id: null, name: 'Everyone' }, ...users]} selectedId={u} onSelect={setU} labelKey="full_name" />
            <View className="h-10" />
          </ScrollView>
          <View className="p-8 pt-4 flex-row gap-3 border-t border-surface-border bg-surface-card">
            <TouchableOpacity onPress={onClose} className="flex-1 py-4 rounded-2xl bg-surface-background border border-surface-border items-center">
              <Text className="text-typography-muted font-bold">Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { onConfirm({ days: d, pipeline_id: p, team_id: t, user_id: u, type }); onClose(); }} className="flex-1 py-4 rounded-2xl bg-brand-primary items-center shadow-lg shadow-brand-primary/30">
              <Text className="text-white font-bold">Generate</Text>
            </TouchableOpacity>
          </View>
    </Popup>
  );
};

const DataTree = ({ data, level = 0 }: { data: any; level?: number }) => {
  const colors = useThemeColors();
  if (!data || typeof data !== 'object') return <Text className="text-typography-main font-mono text-[10px]">{String(data)}</Text>;
  const maskData = (obj: any): any => {
    if (!obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(maskData);
    const masked: any = {};
    for (const [key, value] of Object.entries(obj)) {
      if (key.toLowerCase().includes('id') || key.toLowerCase().includes('uuid')) {
        masked[key] = '********-****-****-****-************';
      } else if (typeof value === 'object') {
        masked[key] = maskData(value);
      } else {
        masked[key] = value;
      }
    }
    return masked;
  };
  const maskedData = maskData(data);
  return (
    <View style={{ marginLeft: level * 12 }}>
      {Object.entries(maskedData).map(([key, val]: [string, any], idx) => (
        <View key={idx} className="mb-2">
          <Text className="text-typography-muted text-[9px] font-black uppercase tracking-widest">{key}</Text>
          {typeof val === 'object' && val !== null ? (
            <DataTree data={val} level={level + 1} />
          ) : (
            <Text className="text-typography-main font-mono text-[11px] leading-relaxed bg-surface-background/50 p-2 rounded-lg mt-1 border border-surface-border/30">
              {String(val)}
            </Text>
          )}
        </View>
      ))}
    </View>
  );
};

const ArchiveDetailModal = ({ visible, onClose, archive, activeSchema, onRestore, hasPermission }: any) => {
  const colors = useThemeColors();
  if (!archive) return null;
  const pipelineId = archive.snapshot?.pipeline_id || archive.snapshot?.child_tasks?.[0]?.pipeline_id;
  const hasIntegrityIssue = pipelineId && !activeSchema.pipelines.has(pipelineId);
  return (
    <Popup visible={visible} onClose={onClose} presentation="auto" maxWidth={420}>
          <View className="px-8 pt-2 pb-4 border-b border-surface-border flex-row justify-between items-center">
            <View className="flex-1">
              <Text className="text-typography-main text-xl font-black mb-1">
                {archive.metadata?.title || archive.metadata?.name || 'Untitled'}
              </Text>
              <Text className="text-typography-muted text-xs uppercase tracking-widest font-bold">
                {archive.entity_type} Snapshot
              </Text>
            </View>
            <TouchableOpacity onPress={onClose} className="w-10 h-10 rounded-full bg-surface-background border border-surface-border items-center justify-center">
              <FontAwesome name="times" size={14} className="text-typography-dim" />
            </TouchableOpacity>
          </View>
          <ScrollView className="px-8 pt-6" showsVerticalScrollIndicator={false}>
            {hasIntegrityIssue && (
              <View className="bg-state-danger/10 border border-state-danger/20 p-5 rounded-2xl mb-8">
                <View className="flex-row items-center mb-2">
                   <FontAwesome name="exclamation-triangle" size={16} color={colors.danger} className="mr-3" />
                   <Text className="text-state-danger font-black">Integrity Breach Detected</Text>
                </View>
                <Text className="text-state-danger/70 text-xs font-bold leading-relaxed">
                   The target pipeline for this archive no longer exists. Direct restoration is locked to prevent orphaned data. Administrative remapping required.
                </Text>
              </View>
            )}
            <Text className="text-typography-muted text-[10px] font-black uppercase tracking-[2px] mb-6">Snapshot Data Trace</Text>
            <DataTree data={archive.snapshot} />
            <View className="h-40" />
          </ScrollView>
          <View className="p-8 bg-surface-card border-t border-surface-border flex-row gap-4">
             <TouchableOpacity onPress={onClose} className="flex-1 py-4 rounded-2xl bg-surface-background border border-surface-border items-center">
                <Text className="text-typography-muted font-bold">Dismiss</Text>
             </TouchableOpacity>
             {!archive.restored_at && !hasIntegrityIssue && hasPermission('archive.restore') && (
               <TouchableOpacity onPress={() => onRestore(archive.id)} className="flex-1 py-4 rounded-2xl bg-brand-primary items-center">
                  <Text className="text-white font-bold">Restore Asset</Text>
               </TouchableOpacity>
              )}
          </View>
    </Popup>
  );
};

// --- MAIN SCREEN COMPONENT ---

export default function IntelligenceScreen() {
  const colors = useThemeColors();
  const { section } = useLocalSearchParams();
  const router = useRouter();
  const { hasPermission, permissionsLoaded, profile } = useAuth();
  const reportCapability = useCapability('report.generate');
  const { showAlert } = useAlert();
  const { successToast, errorToast } = useToast();

  const [activeSection, setActiveSection] = useState('radar');
  const [loading, setLoading] = useState(true);
  const [showReportModal, setShowReportModal] = useState(false);
  const [showArchitect, setShowArchitect] = useState(false);
  // Core Data State
  const [data, setData] = useState<OrganizationalAudit | null>(null);
  const [reports, setReports] = useState<any[]>([]);
  const [pipelines, setPipelines] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [coldArchives, setColdArchives] = useState<any[]>([]);
  const [activeSchema, setActiveSchema] = useState<{ pipelines: Set<string>, stages: Set<string> }>({
    pipelines: new Set(),
    stages: new Set()
  });
  const [archiveSearch, setArchiveSearch] = useState('');
  const [archiveSection, setArchiveSection] = useState<'reports' | 'storage'>('reports');
  const [selectedArchive, setSelectedArchive] = useState<any>(null);
  const [confirmRestore, setConfirmRestore] = useState<{ visible: boolean; archiveId: string | null }>({ visible: false, archiveId: null });
  const [restoring, setRestoring] = useState(false);

  // Current Global State
  const [days, setDays] = useState(30);
  const [pipelineId, setPipelineId] = useState<string | null>(null);
  const { getOrganizationalAudit } = useAnalytics();

  useEffect(() => {
    fetchBaseData();
  }, []);

  useEffect(() => {
    if (section === undefined) return;

    if (section === 'analytics') {
      router.replace('/intelligence/analytics' as any);
      return;
    }
    if (section === 'targets') {
      router.replace('/intelligence/targets' as any);
      return;
    }

    if (section === 'archives' && !permissionsLoaded) return;

    if (section === 'archives' && hasPermission('archive.view')) {
      setActiveSection('archives');
      return;
    }

    if (section !== 'radar') {
      router.replace('/intelligence' as any);
    }
    setActiveSection('radar');
  }, [section, hasPermission, permissionsLoaded, router]);

  useEffect(() => {
    let isMounted = true;
    const fetch = async () => {
      if (!isMounted) return;
      if (activeSection === 'radar') await fetchAudit();
      if (activeSection === 'archives') await fetchReports();
    };
    fetch();
    return () => { isMounted = false; };
  }, [activeSection, pipelineId, days]);

  const fetchBaseData = async () => {
    const { data: p } = await supabase.from('pipelines').select('id, name').is('deleted_at', null);
    const { data: t } = await supabase.from('teams').select('id, name').is('deleted_at', null);
    const { data: u } = await supabase.from('users').select('id, full_name');
    if (p) setPipelines(p);
    if (t) setTeams(t);
    if (u) setUsers(u);
  };

  const fetchAudit = async (forceRefresh = false) => {
    try {
      setLoading(true);
      setData(await getOrganizationalAudit(pipelineId, days, forceRefresh));
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
      await fetchColdArchives();
    } catch (err) { console.error(err); } finally { setLoading(false); }
  };

  const fetchColdArchives = async () => {
    try {
      const { data: archiveData, error: archiveError } = await supabase.rpc('rpc_get_archives', {
        p_search: archiveSearch || null
      });
      if (archiveError) throw archiveError;
      setColdArchives(archiveData || []);

      const [pipelinesRes, stagesRes] = await Promise.all([
        supabase.from('pipelines').select('id'),
        supabase.from('pipeline_stages').select('id')
      ]);

      setActiveSchema({
        pipelines: new Set(pipelinesRes.data?.map(p => p.id) || []),
        stages: new Set(stagesRes.data?.map(s => s.id) || [])
      });
    } catch (err) {
      console.error('[Intelligence] Mobile Archive fetch failed:', err);
    }
  };

  const handleExportPDF = async (params: any) => {
    if (!reportCapability.allowed) {
      showAlert('Access restricted', reportCapability.loading ? 'Checking report access.' : 'Report generation requires an active plan with report access.');
      return;
    }
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
      showAlert('Processing', 'Your report is being generated.');
      if (activeSection === 'archives') fetchReports();
    } catch (err: any) {
      showAlert('Failure', err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadReport = async (path: string) => {
    const { data, error } = await supabase.storage.from('reports').createSignedUrl(path, 60);
    if (!data?.signedUrl) return;
    // expo-linking's openURL navigates the current tab on web (window.location =
    // url); explicit window.open keeps the app tab alive, matching openStorageFile.
    if (Platform.OS === 'web') { window.open(data.signedUrl, '_blank', 'noopener'); return; }
    Linking.openURL(data.signedUrl);
  };

  const handleRestore = async () => {
    if (!confirmRestore.archiveId) return;
    setRestoring(true);
    try {
      const { data: newId, error } = await supabase.rpc(
        selectedArchive?.entity_type === 'project' ? 'rpc_restore_project' : 'rpc_restore_archive',
        { p_archive_id: confirmRestore.archiveId }
      );

      if (error) throw error;

      successToast('Asset has been restored to the active pipeline.', 'Restored');
      setConfirmRestore({ visible: false, archiveId: null });
      setSelectedArchive(null);
      fetchColdArchives();
    } catch (err: any) {
      errorToast(err.message || 'Could not restore this snapshot.', 'Restoration failed');
    } finally {
      setRestoring(false);
    }
  };

  return (
    <View className="flex-1 bg-surface-background">
      <ScrollView className="flex-1" stickyHeaderIndices={[1]} refreshControl={<RefreshControl refreshing={false} onRefresh={() => fetchAudit(true)} />}>
        {/* Header */}
        <View className="px-6 pt-12 pb-6">
          <View className="flex-row items-start justify-between mb-4">
            <View className="flex-1">
              <Text className="text-brand-primary font-black uppercase tracking-[4px] text-[10px] mb-1">Intelligence Center</Text>
              <Text className="text-typography-main text-3xl font-black">Audit Hub</Text>
            </View>
            <BackButton label="" />
          </View>
        </View>

        {/* Section Toggle */}
        <SectionToggle
          active={activeSection}
          onSelect={(s) => {
            if (s === 'analytics') { router.push('/intelligence/analytics' as any); return; }
            setActiveSection(s);
          }}
          hasPermission={hasPermission}
        />

        {/* Main Sections */}
        <View className="px-6">
          {loading ? (
            <View className="py-20 items-center gap-3" accessibilityRole="progressbar" accessibilityLabel="Loading intelligence data">
              <ActivityIndicator color={colors.primary} />
              <Text className="text-typography-muted text-xs">Loading intelligence data…</Text>
            </View>
          ) : pipelines.length === 0 ? (
            <View className="py-10 items-center justify-center">
              <View className="bg-surface-card p-8 rounded-[2rem] border border-surface-border items-center w-full premium-shadow">
                <View className="w-16 h-16 bg-brand-primary/10 rounded-full items-center justify-center mb-6">
                  <FontAwesome name="line-chart" size={24} color={colors.primary} />
                </View>

                {hasPermission('pipeline.edit') ? (
                  <>
                    <Text className="text-typography-main text-xl font-black mb-2 text-center">Setup Required</Text>
                    <Text className="text-typography-muted text-center mb-6 text-xs leading-relaxed">
                      No pipelines found. Analytics require at least one active pipeline to function.
                    </Text>
                    <TouchableOpacity
                      onPress={() => router.push('/admin/pipelines')}
                      className="bg-brand-primary px-8 py-4 rounded-xl active:scale-95"
                    >
                      <Text className="text-white font-black uppercase tracking-widest text-[10px]">Configure</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <View className="bg-state-info-dim border border-state-info/20 p-6 rounded-2xl w-full">
                    <View className="flex-row items-start">
                      <FontAwesome name="info-circle" size={16} color={colors.info} style={{ marginTop: 2 }} />
                      <View className="ml-4 flex-1">
                         <Text className="text-typography-main text-sm font-black mb-1">Access Restricted</Text>
                         <Text className="text-typography-muted text-[11px] font-bold leading-relaxed">
                           Either no pipelines exist now, or they're not privileged enough to see them, contact company Admin
                         </Text>
                      </View>
                    </View>
                  </View>
                )}
              </View>
            </View>
          ) : activeSection === 'radar' ? (
            <RadarSection
              data={data}
              targetWatchEnabled={permissionsLoaded && hasPermission('target.view')}
            />
          ) : activeSection === 'archives' && (
            <ArchivesSection
              reports={reports}
              onDownload={handleDownloadReport}
              onNew={() => setShowArchitect(true)}
              canGenerate={reportCapability.allowed}
              coldArchives={coldArchives}
              activeSchema={activeSchema}
              currentSubSection={archiveSection}
              setSubSection={setArchiveSection}
              onSelectArchive={setSelectedArchive}
              hasPermission={hasPermission}
            />
          )}
        </View>
        <View className="h-20" />
      </ScrollView>

      <ReportConfigModal
        visible={showReportModal}
        onClose={() => setShowReportModal(false)}
        onConfirm={handleExportPDF}
        pipelines={pipelines}
        teams={teams}
        users={users}
        initialDays={days}
      />

      <ReportGeneratorAdaptive
        visible={showArchitect}
        onClose={() => setShowArchitect(false)}
        onReportGenerated={fetchReports}
      />

      <ArchiveDetailModal
        visible={!!selectedArchive}
        onClose={() => setSelectedArchive(null)}
        archive={selectedArchive}
        activeSchema={activeSchema}
        onRestore={(id: string) => {
          setSelectedArchive(null);
          setConfirmRestore({ visible: true, archiveId: id });
        }}
        hasPermission={hasPermission}
      />

      <ConfirmModal
        visible={confirmRestore.visible}
        title="Restore Archive"
        description="This will return the archived asset to the active workflow pipeline."
        confirmLabel="Restore"
        onConfirm={() => {
          handleRestore();
          setConfirmRestore({ visible: false, archiveId: null });
        }}
        onCancel={() => setConfirmRestore({ visible: false, archiveId: null })}
        variant="primary"
        loading={restoring}
      />
    </View>
  );
}
